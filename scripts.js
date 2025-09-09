// --- GLOBAL VARIABLES ---
let currentUser = null;
let currentEventIndex = null;
let upcomingEvents = []; 
let websocket = null;
let currentChatTeam = null;
let notificationWebSocket = null;
let unreadNotificationCount = 0;

const ongoingEvents = [ 
    { id: 5, name: "National Volleyball Championship", date: "2025-09-07", emoji: "🏐" }, 
    { id: 6, name: "Engineering Football League", date: "2025-09-07", emoji: "⚽" } 
];

const pastEvents = [ 
    { id: 7, name: "Boys Basketball Tournament", date: "2025-08-22", emoji: "🏀" }, 
    { id: 8, name: "Girls Hockey League", date: "2025-08-15", emoji: "🏒" } 
];

// --- JWT CONFIGURATION ---
const JWT_CONFIG = {
    ACCESS_TOKEN_KEY: 'accessToken',
    REFRESH_TOKEN_KEY: 'refreshToken',
    TOKEN_EXPIRY_BUFFER: 2 * 60 * 1000, // 2 minutes before expiry
    MAX_RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000 // 1 second
};

// --- ROUTING CONFIGURATION ---
const ROUTES = {
    '/': 'dashboardSection',
    '/dashboard': 'dashboardSection',
    '/events': 'upcomingSection',
    '/events/upcoming': 'upcomingSection',
    '/events/ongoing': 'ongoingSection',
    '/events/past': 'pastSection',
    '/teams': 'myTeamsSection',
    '/profile': 'profileSection'
};

const ROUTE_TITLES = {
    '/': 'SportsHub - Dashboard',
    '/dashboard': 'SportsHub - Dashboard',
    '/events': 'SportsHub - Upcoming Events',
    '/events/upcoming': 'SportsHub - Upcoming Events',
    '/events/ongoing': 'SportsHub - Live Events',
    '/events/past': 'SportsHub - Past Events',
    '/teams': 'SportsHub - My Teams',
    '/profile': 'SportsHub - Profile'
};

// --- CONFIGURATION ---
const API_BASE_URL = 'https://sportshub-backend-fkye.onrender.com';

// Global variables for token management
let tokenRefreshTimer = null;
let isRefreshing = false;
let refreshPromise = null;
let failedRequestsQueue = [];

// --- UTILITY FUNCTIONS ---
function logDebug(message, data = null) {
    console.log(`[DEBUG] ${message}`, data);
}

function logError(message, error = null) {
    console.error(`[ERROR] ${message}`, error);
}

// --- IMPROVED JWT TOKEN MANAGEMENT ---
function saveAuthTokens(accessToken, refreshToken) {
    try {
        if (!isValidTokenFormat(accessToken)) {
            throw new Error('Invalid access token format');
        }
        
        localStorage.setItem(JWT_CONFIG.ACCESS_TOKEN_KEY, accessToken);
        if (refreshToken) {
            localStorage.setItem(JWT_CONFIG.REFRESH_TOKEN_KEY, refreshToken);
        }
        
        scheduleTokenRefresh(accessToken);
        logDebug('JWT tokens saved with automatic refresh scheduled');
    } catch (error) {
        logError('Failed to save auth tokens', error);
        throw error;
    }
}

function getAccessToken() {
    const token = localStorage.getItem(JWT_CONFIG.ACCESS_TOKEN_KEY);
    
    if (!token) return null;
    
    // Check if token is expired or about to expire
    if (isTokenExpired(token)) {
        logDebug('Access token expired or about to expire');
        return null;
    }
    
    return token;
}

function getRefreshToken() {
    return localStorage.getItem(JWT_CONFIG.REFRESH_TOKEN_KEY);
}

function clearAuthData() {
    localStorage.removeItem(JWT_CONFIG.ACCESS_TOKEN_KEY);
    localStorage.removeItem(JWT_CONFIG.REFRESH_TOKEN_KEY);
    localStorage.removeItem('sportsHubUser');
    clearTokenRefreshTimer();
    currentUser = null;
    isRefreshing = false;
    refreshPromise = null;
    failedRequestsQueue = [];
    logDebug('Auth data cleared');
}

// --- TOKEN VALIDATION ---
function isValidTokenFormat(token) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    return parts.length === 3;
}

function isTokenExpired(token) {
    try {
        if (!isValidTokenFormat(token)) return true;
        
        const payload = JSON.parse(atob(token.split('.')[1]));
        const currentTime = Date.now() / 1000;
        
        // Add buffer time for proactive token refresh
        const expiryWithBuffer = payload.exp - (JWT_CONFIG.TOKEN_EXPIRY_BUFFER / 1000);
        return currentTime >= expiryWithBuffer;
    } catch (error) {
        logError('Error checking token expiration', error);
        return true;
    }
}

function getTokenPayload(token) {
    try {
        if (!isValidTokenFormat(token)) return null;
        return JSON.parse(atob(token.split('.')[1]));
    } catch (error) {
        logError('Error parsing token payload', error);
        return null;
    }
}

// --- AUTO TOKEN REFRESH ---
function scheduleTokenRefresh(token) {
    clearTokenRefreshTimer();
    
    const payload = getTokenPayload(token);
    if (!payload) return;
    
    const now = Date.now();
    const expiry = payload.exp * 1000;
    const refreshTime = expiry - JWT_CONFIG.TOKEN_EXPIRY_BUFFER;
    
    if (refreshTime > now) {
        const delay = refreshTime - now;
        tokenRefreshTimer = setTimeout(() => {
            refreshTokenIfPossible();
        }, delay);
        
        logDebug(`Token refresh scheduled in ${Math.round(delay / 1000)} seconds`);
    }
}

function clearTokenRefreshTimer() {
    if (tokenRefreshTimer) {
        clearTimeout(tokenRefreshTimer);
        tokenRefreshTimer = null;
    }
}

async function refreshTokenIfPossible() {
    // Prevent multiple simultaneous refresh attempts
    if (isRefreshing) {
        return refreshPromise;
    }
    
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
        logDebug('No refresh token available, redirecting to login');
        handleAuthExpiry();
        return false;
    }
    
    isRefreshing = true;
    refreshPromise = performTokenRefresh(refreshToken);
    
    try {
        const result = await refreshPromise;
        return result;
    } finally {
        isRefreshing = false;
        refreshPromise = null;
    }
}

async function performTokenRefresh(refreshToken) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ refreshToken })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Token refresh failed');
        }
        
        // Save new tokens
        saveAuthTokens(data.accessToken, data.refreshToken);
        
        // Retry all failed requests with new token
        processFailedRequestsQueue();
        
        logDebug('Token refreshed successfully');
        return true;
        
    } catch (error) {
        logError('Token refresh failed', error);
        handleAuthExpiry();
        return false;
    }
}

function addToFailedRequestsQueue(request) {
    failedRequestsQueue.push(request);
}

async function processFailedRequestsQueue() {
    const queue = [...failedRequestsQueue];
    failedRequestsQueue = [];
    
    for (const request of queue) {
        try {
            const result = await apiRequest(request.endpoint, request.options);
            if (request.resolve) {
                request.resolve(result);
            }
        } catch (error) {
            if (request.reject) {
                request.reject(error);
            }
        }
    }
}

function handleAuthExpiry() {
    logDebug('Authentication expired');
    clearAuthData();
    
    if (websocket) {
        websocket.close();
        websocket = null;
    }
    
    if (notificationWebSocket) {
        notificationWebSocket.close();
        notificationWebSocket = null;
    }
    
    showAuth();
    showNotification('Your session has expired. Please login again.', 'warning');
}

// --- ENHANCED API REQUEST WITH AUTOMATIC TOKEN REFRESH ---
async function apiRequest(endpoint, options = {}, retryCount = 0) {
    const url = `${API_BASE_URL}${endpoint}`;
    
    // Skip auth for public endpoints
    const publicEndpoints = ['/api/login', '/api/register', '/api/auth/refresh', '/health'];
    const skipAuth = publicEndpoints.includes(endpoint);
    
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    };
    
    // Add Authorization header if not skipping auth
    if (!skipAuth) {
        const token = getAccessToken();
        if (token) {
            defaultOptions.headers['Authorization'] = `Bearer ${token}`;
        } else if (currentUser) {
            // Try to refresh token first
            const refreshed = await refreshTokenIfPossible();
            if (refreshed) {
                const newToken = getAccessToken();
                if (newToken) {
                    defaultOptions.headers['Authorization'] = `Bearer ${newToken}`;
                }
            } else {
                return { success: false, error: 'Authentication required' };
            }
        }
    }
    
    const finalOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    };
    
    try {
        const response = await fetch(url, finalOptions);
        const data = await response.json();
        
        logDebug(`API Response (${response.status}):`, data);
        
        // Handle authentication errors with token refresh
        if (response.status === 401 || response.status === 403) {
            if (!skipAuth && data.code === 'TOKEN_EXPIRED' && retryCount < JWT_CONFIG.MAX_RETRY_ATTEMPTS) {
                logDebug('Token expired, attempting refresh and retry');
                
                const refreshed = await refreshTokenIfPossible();
                if (refreshed) {
                    // Retry the original request with new token
                    return apiRequest(endpoint, options, retryCount + 1);
                }
            }
            
            logError('Authentication failed, redirecting to login');
            handleAuthExpiry();
            return { success: false, error: 'Authentication required' };
        }
        
        if (!response.ok) {
            throw new Error(data.message || `HTTP error! status: ${response.status}`);
        }
        
        return { success: true, data, status: response.status };
    } catch (error) {
        // Handle network errors with retry
        if (retryCount < JWT_CONFIG.MAX_RETRY_ATTEMPTS && 
            (error.name === 'TypeError' || error.message.includes('fetch'))) {
            
            logDebug(`Network error, retrying in ${JWT_CONFIG.RETRY_DELAY}ms (attempt ${retryCount + 1})`);
            await new Promise(resolve => setTimeout(resolve, JWT_CONFIG.RETRY_DELAY));
            return apiRequest(endpoint, options, retryCount + 1);
        }
        
        logError(`API request failed for ${endpoint}`, error);
        return { success: false, error: error.message };
    }
}

// --- SIDEBAR FUNCTIONALITY ---
function setupSidebarEventListeners() {
    const hamburgerMenu = document.getElementById('hamburgerMenu');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const eventsToggle = document.getElementById('eventsToggle');
    const sidebarLogout = document.getElementById('sidebarLogout');

    // Hamburger menu toggle
    if (hamburgerMenu) {
        hamburgerMenu.addEventListener('click', toggleSidebar);
    }

    // Close sidebar when clicking overlay
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }

    // Events submenu toggle
    if (eventsToggle) {
        eventsToggle.addEventListener('click', function(e) {
            e.preventDefault();
            toggleSubmenu('eventsSubmenu');
        });
    }

    // Sidebar logout
    if (sidebarLogout) {
        sidebarLogout.addEventListener('click', function(e) {
            e.preventDefault();
            handleLogout();
        });
    }

    // Close sidebar when clicking navigation items on mobile
    const navItems = sidebar?.querySelectorAll('.nav-item[data-route]');
    navItems?.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                closeSidebar();
            }
        });
    });
}

function toggleSidebar() {
    const hamburgerMenu = document.getElementById('hamburgerMenu');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    if (sidebar && hamburgerMenu) {
        const isActive = sidebar.classList.toggle('active');
        hamburgerMenu.classList.toggle('active', isActive);
        
        if (sidebarOverlay) {
            sidebarOverlay.classList.toggle('active', isActive);
        }

        if (window.innerWidth <= 768) {
            document.body.style.overflow = isActive ? 'hidden' : '';
        }
    }
}

function closeSidebar() {
    const hamburgerMenu = document.getElementById('hamburgerMenu');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    if (sidebar) {
        sidebar.classList.remove('active');
    }
    if (hamburgerMenu) {
        hamburgerMenu.classList.remove('active');
    }
    if (sidebarOverlay) {
        sidebarOverlay.classList.remove('active');
    }

    document.body.style.overflow = '';
}

function toggleSubmenu(submenuId) {
    const submenu = document.getElementById(submenuId);
    const toggle = document.getElementById(submenuId.replace('Submenu', 'Toggle'));
    
    if (submenu && toggle) {
        const isActive = submenu.classList.toggle('active');
        toggle.classList.toggle('expanded', isActive);
    }
}

// --- NAVIGATION FUNCTIONS ---
function updateActiveNavigation(currentRoute) {
    const navItems = document.querySelectorAll('.sidebar .nav-item[data-route]');
    navItems.forEach(item => {
        const route = item.getAttribute('data-route');
        item.classList.toggle('active', route === currentRoute || 
            (currentRoute.startsWith('/events') && route === '/events'));
    });

    const mobileNavItems = document.querySelectorAll('.mobile-nav .mobile-nav-item');
    mobileNavItems.forEach(item => {
        const route = item.getAttribute('data-route');
        item.classList.toggle('active', route === currentRoute ||
            (currentRoute.startsWith('/events') && route === '/events/upcoming') ||
            (currentRoute === '/dashboard' && route === '/dashboard'));
    });

    if (currentRoute.startsWith('/events')) {
        const eventsSubmenu = document.getElementById('eventsSubmenu');
        const eventsToggle = document.getElementById('eventsToggle');
        if (eventsSubmenu && eventsToggle) {
            eventsSubmenu.classList.add('active');
            eventsToggle.classList.add('expanded');
        }
    }
}

function handleResize() {
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    if (window.innerWidth > 768) {
        if (sidebarOverlay) {
            sidebarOverlay.classList.remove('active');
        }
        document.body.style.overflow = '';
    } else {
        if (sidebar?.classList.contains('active')) {
            document.body.style.overflow = 'hidden';
        }
    }
}

function setupKeyboardNavigation() {
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeSidebar();
        }
        
        if (e.altKey && e.key === 'm') {
            e.preventDefault();
            toggleSidebar();
        }
    });
}

function setupNotificationHandler() {
    const notifIcon = document.getElementById('notificationIcon');
    const notifPanel = document.getElementById('notificationPanel');
    
    if (notifIcon && notifPanel) {
        notifIcon.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            const isVisible = notifPanel.classList.toggle('show'); 
            if (isVisible) {
                renderNotifications();
                markNotificationsAsRead();
            }
        });
    }
    
    document.addEventListener('click', (e) => {
        if (notifIcon && notifPanel && !notifIcon.contains(e.target) && !notifPanel.contains(e.target)) {
            notifPanel.classList.remove('show');
        }
    });
}

// --- ROUTING FUNCTIONS ---
function initializeRouter() {
    handleRoute();
    window.addEventListener('popstate', handleRoute);
    
    document.addEventListener('click', (e) => {
        const routeElement = e.target.closest('[data-route]');
        if (routeElement) {
            e.preventDefault();
            const route = routeElement.getAttribute('data-route');
            navigateTo(route);
        }
    });
}

function navigateTo(path) {
    history.pushState(null, '', path);
    handleRoute();
}

function handleRoute() {
    const path = window.location.pathname;
    const sectionId = ROUTES[path] || ROUTES['/dashboard'];
    
    document.title = ROUTE_TITLES[path] || 'SportsHub';
    showSectionByRoute(sectionId);
    updateActiveNavigation(path);
    
    logDebug(`Navigated to: ${path} -> ${sectionId}`);
}

function showSectionByRoute(sectionId) {
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.add('active');
        loadSectionData(sectionId);
    }
}

function loadSectionData(sectionId) {
    switch(sectionId) {
        case 'upcomingSection':
            renderEvents(filterEvents(upcomingEvents), 'upcomingEventsGrid', true);
            break;
        case 'ongoingSection':
            renderEvents(ongoingEvents, 'ongoingEventsGrid');
            break;
        case 'pastSection':
            renderEvents(pastEvents, 'pastEventsGrid');
            break;
        case 'myTeamsSection':
            renderMyTeams();
            break;
        case 'profileSection':
            renderProfile();
            break;
        case 'dashboardSection':
            updateDashboardStats();
            break;
    }
}

function updateDashboardStats() {
    const actionCards = document.querySelectorAll('.action-card .count');
    const statCard = document.querySelector('.stat-card:nth-child(3) p');
    
    if (actionCards.length >= 1) actionCards[0].textContent = upcomingEvents.length;
    if (statCard) statCard.textContent = upcomingEvents.length;
}

// --- DATA PERSISTENCE ---
function saveData() { 
    if (currentUser) {
        localStorage.setItem('sportsHubUser', JSON.stringify(currentUser)); 
    }
}

function loadData() { 
    const data = localStorage.getItem('sportsHubUser'); 
    if (data) {
        try {
            currentUser = JSON.parse(data);
            logDebug('User data loaded from localStorage', currentUser);
        } catch (error) {
            logError('Failed to parse user data from localStorage', error);
            localStorage.removeItem('sportsHubUser');
        }
    }
}

// --- NOTIFICATION WEBSOCKET FUNCTIONS ---
function initializeNotificationWebSocket() {
    if (notificationWebSocket && notificationWebSocket.readyState === WebSocket.OPEN) {
        return;
    }
    
    const wsUrl = API_BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://') + '/notifications';
    notificationWebSocket = new WebSocket(wsUrl);
    
    notificationWebSocket.onopen = function() {
        logDebug('Connected to notification WebSocket server');
        if (currentUser) {
            notificationWebSocket.send(JSON.stringify({
                type: 'register',
                userEmail: currentUser.email
            }));
        }
    };
    
    notificationWebSocket.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'notification') {
                handleNewNotification(data.notification);
            }
        } catch (error) {
            logError('Error parsing notification WebSocket message', error);
        }
    };
    
    notificationWebSocket.onclose = function() {
        logDebug('Notification WebSocket connection closed');
        setTimeout(initializeNotificationWebSocket, 3000);
    };
    
    notificationWebSocket.onerror = function(error) {
        logError('Notification WebSocket error', error);
    };
}

function handleNewNotification(notification) {
    if (!currentUser) return;
    
    currentUser.notifications.unshift(notification);
    
    if (currentUser.notifications.length > 10) {
        currentUser.notifications = currentUser.notifications.slice(0, 10);
    }
    
    unreadNotificationCount++;
    updateNotificationBadge();
    saveData();
    showNotification(`${notification.title}: ${notification.body}`, 'success');
    logDebug('New notification received:', notification);
}

function updateNotificationBadge() {
    const notificationBadge = document.getElementById('notificationBadge');
    if (notificationBadge) {
        if (unreadNotificationCount > 0) {
            notificationBadge.textContent = unreadNotificationCount;
            notificationBadge.style.display = 'flex';
        } else {
            notificationBadge.style.display = 'none';
        }
    }
}

async function markNotificationsAsRead() {
    if (!currentUser || unreadNotificationCount === 0) return;

    try {
        const result = await apiRequest('/api/notifications/mark-read', {
            method: 'POST'
        });

        if (result.success) {
            currentUser.notifications.forEach(n => n.read = true);
            saveData(); 

            unreadNotificationCount = 0;
            updateNotificationBadge();
            logDebug('Notifications marked as read');
        }
    } catch (error) {
        logError('Failed to mark notifications as read', error);
    }
}

function formatNotificationTime(timestamp) {
    if (!timestamp) return '';
    
    const now = new Date();
    const notificationTime = new Date(timestamp);
    const diffInMinutes = Math.floor((now - notificationTime) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
}

// --- CHAT WEBSOCKET FUNCTIONS ---
function initializeWebSocket() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        return;
    }
    
    const wsUrl = API_BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    websocket = new WebSocket(wsUrl);
    
    websocket.onopen = function() {
        logDebug('Connected to WebSocket server');
        updateChatStatus('connected');
    };
    
    websocket.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'message') {
                displayChatMessage(data);
            }
        } catch (error) {
            logError('Error parsing WebSocket message', error);
        }
    };
    
    websocket.onclose = function() {
        logDebug('WebSocket connection closed');
        updateChatStatus('disconnected');
        setTimeout(initializeWebSocket, 3000);
    };
    
    websocket.onerror = function(error) {
        logError('WebSocket error', error);
        updateChatStatus('disconnected');
    };
}

function joinTeamChat(teamName) {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        initializeWebSocket();
        setTimeout(() => joinTeamChat(teamName), 1000);
        return;
    }
    
    currentChatTeam = teamName;
    websocket.send(JSON.stringify({
        type: 'join',
        teamName: teamName
    }));
}

function sendChatMessage(message) {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        showNotification('Chat connection lost. Trying to reconnect...', 'error');
        initializeWebSocket();
        return;
    }
    
    if (!currentChatTeam) {
        showNotification('Please join a team chat first', 'error');
        return;
    }
    
    websocket.send(JSON.stringify({
        type: 'message',
        sender: currentUser.fullName,
        text: message,
        teamName: currentChatTeam
    }));
}

function displayChatMessage(messageData) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${messageData.sender === currentUser.fullName ? 'sent' : 'received'}`;
    
    const timestamp = new Date(messageData.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    messageDiv.innerHTML = `
        <div class="sender-info">${messageData.sender} • ${timestamp}</div>
        <div class="message-bubble">${escapeHtml(messageData.text)}</div>
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function openTeamChat(teamName) {
    const chatModal = document.getElementById('chatModal');
    const chatModalTitle = document.getElementById('chatModalTitle');
    const chatMessages = document.getElementById('chatMessages');
    
    chatModalTitle.textContent = `${teamName} Chat`;
    chatMessages.innerHTML = '';
    chatModal.classList.add('active');
    
    try {
        const historyResult = await apiRequest(`/api/chat/${teamName}`);
        if (historyResult.success) {
            historyResult.data.forEach(message => displayChatMessage(message));
        } else {
            chatMessages.innerHTML = '<div class="chat-status">Could not load chat history.</div>';
        }
    } catch (error) {
        logError('Failed to fetch chat history', error);
    }
    
    joinTeamChat(teamName);
}

function closeChatModal() {
    const chatModal = document.getElementById('chatModal');
    chatModal.classList.remove('active');
    currentChatTeam = null;
    
    if (websocket) {
        logDebug('Closing WebSocket connection.');
        websocket.close();
        websocket = null;
    }
}

function updateChatStatus(status) {
    const chatStatus = document.getElementById('chatStatus');
    if (chatStatus) {
        if (status === 'connected') {
            chatStatus.textContent = 'Connected to team chat';
            chatStatus.className = 'chat-status connected';
            setTimeout(() => {
                if (chatStatus.parentNode) {
                    chatStatus.remove();
                }
            }, 2000);
        } else {
            chatStatus.textContent = 'Disconnected - trying to reconnect...';
            chatStatus.className = 'chat-status disconnected';
        }
    }
}

// --- INITIALIZATION ---
function init() {
    logDebug('Initializing application');
    setupEventListeners();
    setupChatEventListeners();
    setupSidebarEventListeners();
    setupKeyboardNavigation();
    setupNotificationHandler();
    loadData();
    
    if (currentUser && getAccessToken()) { 
        showApp();
        initializeWebSocket();
        initializeRouter();
    } else { 
        showAuth();
    }

    window.addEventListener('resize', handleResize);
}

function showAuth() {
    document.getElementById('authContainer').style.display = 'flex';
    document.getElementById('mainContainer').style.display = 'none';
}

async function showApp() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    
    await fetchAndRenderUpcomingEventsWithRetry();
    renderEvents(ongoingEvents, 'ongoingEventsGrid');
    renderEvents(pastEvents, 'pastEventsGrid');
    updateUIForUser();
    initializeNotificationWebSocket();
}

// --- FETCH DATA FROM BACKEND ---
async function fetchAndRenderUpcomingEventsWithRetry() {
    const maxRetries = 3;
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            logDebug(`Fetch attempt ${i + 1}/${maxRetries}`);
            
            const result = await apiRequest('/api/events');
            
            if (!result.success) {
                throw new Error(result.error);
            }
            
            const events = result.data;
            logDebug('Successfully fetched events:', events.length);
            
            const validEvents = events.filter(event => {
                const isValid = event.id != null && event.team != null;
                if (!isValid) {
                    logError('Invalid event structure:', event);
                }
                return isValid;
            });
            
            if (validEvents.length !== events.length) {
                logError(`Filtered out ${events.length - validEvents.length} invalid events`);
            }
            
            upcomingEvents = validEvents;
            renderEvents(filterEvents(upcomingEvents), 'upcomingEventsGrid', true);
            
            const actionCard = document.querySelector('.action-card:nth-child(1) .count');
            const statCard = document.querySelector('.stat-card:nth-child(3) p');
            if (actionCard) actionCard.textContent = upcomingEvents.length;
            if (statCard) statCard.textContent = upcomingEvents.length;
            
            return;
            
        } catch (error) {
            logError(`Fetch attempt ${i + 1} failed:`, error);
            lastError = error;
            
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
            }
        }
    }
    
    logError('All fetch attempts failed:', lastError);
    showNotification('Failed to load events after multiple attempts. Please check your connection.', 'error');
}

async function fetchAndRenderUpcomingEvents() {
    return await fetchAndRenderUpcomingEventsWithRetry();
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    setupAuthTabs();
    setupFormValidation();
    
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('applicationForm').addEventListener('submit', handleApplication);
    
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    if (searchInput) searchInput.addEventListener('input', () => renderEvents(filterEvents(upcomingEvents), 'upcomingEventsGrid', true));
    if (categoryFilter) categoryFilter.addEventListener('change', () => renderEvents(filterEvents(upcomingEvents), 'upcomingEventsGrid', true));
    
    document.getElementById('changePhotoButton').addEventListener('click', handleChangePhoto);
    document.getElementById('logoutButton').addEventListener('click', handleLogout);
    document.getElementById('editProfileButton').addEventListener('click', handleEditProfileClick);
    document.getElementById('avatarUploadInput').addEventListener('change', handleFileUpload);
    
    window.addEventListener('click', (e) => { 
        if (e.target.id === 'joinModal') closeJoinModal(); 
        if (e.target.id === 'chatModal') closeChatModal();
    });
}

function setupChatEventListeners() {
    const chatForm = document.getElementById('chatForm');
    if (chatForm) {
        chatForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const messageInput = document.getElementById('chatMessageInput');
            const message = messageInput.value.trim();
            
            if (message) {
                sendChatMessage(message);
                messageInput.value = '';
            }
        });
    }
    
    const closeChatBtn = document.getElementById('closeChatModalBtn');
    if (closeChatBtn) {
        closeChatBtn.addEventListener('click', closeChatModal);
    }
}

// --- AUTHENTICATION HANDLERS ---
async function handleLogin(e) {
    e.preventDefault();
    logDebug('Handling login attempt');
    
    if (!validateLoginEmail() || !validateLoginPassword()) {
        return showNotification('Please fix the errors above', 'error');
    }
    
    const formData = {
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
    };
    
    const result = await apiRequest('/api/login', {
        method: 'POST',
        body: JSON.stringify(formData)
    });
    
    if (result.success) {
        // Save the JWT tokens
        saveAuthTokens(result.data.accessToken, result.data.refreshToken);
        
        currentUser = {
            ...result.data.user,
            avatarUrl: result.data.user.avatarUrl || null,
            joinedTeams: result.data.user.joinedTeams || [],
            notifications: result.data.user.notifications || []
        };
        
        saveData();
        showApp();
        initializeWebSocket();
        initializeRouter();
        navigateTo('/dashboard'); 
        showNotification(result.data.message, 'success');
        
        logDebug('Login successful, tokens saved');
    } else {
        showNotification(result.error, 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    logDebug('Handling registration attempt');
    
    const fields = ['regFullName', 'regStudentID', 'regEmail', 'regPassword', 'regConfirmPassword'];
    const allValid = fields.every(id => validateRegisterField(id, document.getElementById(id).value));
    if (!allValid) return showNotification('Please fix the errors above', 'error');
    
    const formData = {
        fullName: document.getElementById('regFullName').value,
        studentID: document.getElementById('regStudentID').value,
        email: document.getElementById('regEmail').value,
        password: document.getElementById('regPassword').value
    };
    
    const result = await apiRequest('/api/register', {
        method: 'POST',
        body: JSON.stringify(formData)
    });
    
    if (result.success) {
        showNotification('Registration successful! Please login now.', 'success');
        document.getElementById('loginTab').click();
        document.getElementById('registerForm').reset();
    } else {
        showNotification(result.error, 'error');
    }
}

async function handleLogout() {
    logDebug('Handling logout');
    
    const refreshToken = getRefreshToken();
    
    // Call logout API endpoint
    await apiRequest('/api/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken })
    });
    
    // Clear local data
    clearAuthData();
    
    if (websocket) {
        websocket.close();
        websocket = null;
    }
    
    if (notificationWebSocket) {
        notificationWebSocket.close();
        notificationWebSocket = null;
    }
    
    showAuth();
    showNotification('Logged out successfully', 'success');
}

function handleChangePhoto() {
    if (!currentUser) return;
    document.getElementById('avatarUploadInput').click();
}

async function handleEditProfileClick() {
    const profileCard = document.getElementById('profileDetails').closest('.profile-card');
    const editButton = document.getElementById('editProfileButton');
    const isEditing = profileCard.classList.contains('is-editing');

    if (isEditing) {
        const updatedData = {
            fullName: document.getElementById('editProfileFullName').value,
            mobileNumber: document.getElementById('editProfileMobileNumber').value
        };
        
        const result = await apiRequest('/api/profile/update', {
            method: 'POST',
            body: JSON.stringify(updatedData)
        });
        
        if (result.success) {
            currentUser.fullName = result.data.user.fullName;
            currentUser.mobileNumber = result.data.user.mobileNumber;
            saveData();
            renderProfile();
            showNotification(result.data.message, 'success');
        } else {
            showNotification(result.error, 'error');
        }
        
        editButton.textContent = 'Edit Profile';
        profileCard.classList.remove('is-editing');
    } else {
        document.getElementById('editProfileFullName').value = currentUser.fullName;
        document.getElementById('editProfileMobileNumber').value = currentUser.mobileNumber || '';
        editButton.textContent = 'Save Changes';
        profileCard.classList.add('is-editing');
    }
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    try {
        const token = getAccessToken();
        const response = await fetch(`${API_BASE_URL}/api/profile/avatar-upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData 
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message);
        }

        currentUser.avatarUrl = result.avatarUrl;
        saveData();
        updateUserAvatar();
        showNotification('Profile photo updated successfully!', 'success');

    } catch (error) {
        console.error('File upload failed:', error);
        showNotification(error.message || 'File upload failed.', 'error');
    }
}

// --- TEAM & APPLICATION LOGIC ---
async function handleApplication(e) {
    e.preventDefault();
    logDebug('Handling application submission');
    
    const event = upcomingEvents[currentEventIndex];
    
    if (!event || (!event.id && event.id !== 0)) {
        logError('Event data is missing or invalid');
        showNotification('Event data is missing. Please refresh and try again.', 'error');
        return;
    }
    
    const applicationData = {
        userRegNumber: document.getElementById('applicantRegNumber').value,
        userExperience: parseInt(document.getElementById('applicantExperience').value)
    };
    
    logDebug('Application data:', applicationData);
    
    const result = await apiRequest(`/api/events/${event.id}/join`, {
        method: 'POST',
        body: JSON.stringify(applicationData)
    });
    
    if (result.success) {
        currentUser.joinedTeams.push({ 
            eventId: event.id,
            eventName: event.name, 
            teamName: event.team.name, 
            emoji: event.emoji 
        });
        saveData();
        await fetchAndRenderUpcomingEvents();
        updateUIForUser();
        closeJoinModal();
        showNotification(result.data.message, 'success');
    } else {
        showNotification(result.error, 'error');
    }
}

async function handleLeaveTeam(teamName) {
    if (!currentUser || !confirm(`Are you sure you want to leave ${teamName}?`)) return;
    
    logDebug('Handling leave team:', teamName);
    
    const result = await apiRequest('/api/teams/leave', {
        method: 'POST',
        body: JSON.stringify({ teamName })
    });
    
    if (result.success) {
        currentUser.joinedTeams = currentUser.joinedTeams.filter(team => team.teamName !== teamName);
        saveData();
        await fetchAndRenderUpcomingEvents();
        updateUIForUser();
        renderMyTeams();
        showNotification(result.data.message, 'success');
    } else {
        showNotification(result.error, 'error');
    }
}

// --- FORM VALIDATION ---
function setupAuthTabs() { 
    const lT = document.getElementById('loginTab'), rT = document.getElementById('registerTab'), 
          lF = document.getElementById('loginForm'), rF = document.getElementById('registerForm'); 
    
    if (!lT || !rT || !lF || !rF) return;
    
    lT.addEventListener('click', () => { 
        lT.classList.add('active'); rT.classList.remove('active'); 
        lF.style.display = 'block'; rF.style.display = 'none'; 
    }); 
    rT.addEventListener('click', () => { 
        rT.classList.add('active'); lT.classList.remove('active'); 
        lF.style.display = 'none'; rF.style.display = 'block'; 
    });
}

function setupFormValidation() { 
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    
    if (loginEmail) loginEmail.addEventListener('input', validateLoginEmail); 
    if (loginPassword) loginPassword.addEventListener('input', validateLoginPassword);
    
    ['regFullName', 'regStudentID', 'regEmail', 'regPassword', 'regConfirmPassword'].forEach(id => { 
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('input', (e) => validateRegisterField(id, e.target.value)); 
        }
    });
}

function validateLoginEmail() { 
    const e = document.getElementById('loginEmail');
    const r = document.getElementById('loginEmailError'); 
    if (!e || !r) return true;
    
    if (!e.value) { setFieldError(e, r, ''); return false; } 
    if (!/^[a-zA-Z0-9]+\.[a-zA-Z0-9]+@college\.edu$/.test(e.value)) { 
        setFieldError(e, r, 'Format: name.surname@college.edu'); return false; 
    } 
    setFieldSuccess(e, r); return true; 
}

function validateLoginPassword() { 
    const p = document.getElementById('loginPassword');
    const e = document.getElementById('loginPasswordError'); 
    if (!p || !e) return true;
    
    if (!p.value) { setFieldError(p, e, ''); return false; } 
    if (p.value.length < 6) { setFieldError(p, e, 'Password must be >= 6 characters'); return false; } 
    setFieldSuccess(p, e); return true; 
}

function setFieldError(i, e, m) { 
    if (i && e) {
        i.classList.add('error'); 
        e.textContent = m; 
    }
}

function setFieldSuccess(i, e) { 
    if (i && e) {
        i.classList.remove('error'); 
        e.textContent = ''; 
    }
}

function validateRegisterField(f, v) { 
    const i = document.getElementById(f);
    const e = document.getElementById(f + 'Error'); 
    if (!i || !e) return true;
    
    let a = true; 
    switch (f) { 
        case 'regFullName': 
            if (v.length < 2) { setFieldError(i, e, 'Full name must be at least 2 characters'); a = false; } 
            break; 
        case 'regStudentID': 
            if (!/^20\d{2}[A-Z]{2}\d{3}$/.test(v)) { setFieldError(i, e, 'Format: 2021CS001, etc.'); a = false; } 
            break; 
        case 'regEmail': 
            if (!/^[a-zA-Z0-9]+\.[a-zA-Z0-9]+@college\.edu$/.test(v)) { 
                setFieldError(i, e, 'Format: name.surname@college.edu'); a = false; 
            } 
            break; 
        case 'regPassword': 
            if (v.length < 6) { setFieldError(i, e, 'Password must be >= 6 characters'); a = false; } 
            break; 
        case 'regConfirmPassword': 
            const passwordField = document.getElementById('regPassword');
            if (passwordField && v !== passwordField.value) { 
                setFieldError(i, e, 'Passwords do not match'); a = false; 
            } 
            break; 
    } 
    if (a) setFieldSuccess(i, e); 
    return a; 
}

// --- UI UPDATE & RENDERING ---
function updateUIForUser() {
    if (!currentUser) return;
    
    const elements = {
        userName: document.getElementById('userName'),
        welcomeUserName: document.getElementById('welcomeUserName'),
        userRegNumber: document.getElementById('userRegNumber'),
        teamsJoinedCount: document.getElementById('teamsJoinedCount'),
        myTeamsCount: document.getElementById('myTeamsCount')
    };
    
    if (elements.userName) elements.userName.textContent = currentUser.fullName;
    if (elements.welcomeUserName) elements.welcomeUserName.textContent = currentUser.fullName;
    if (elements.userRegNumber) elements.userRegNumber.textContent = currentUser.studentID;
    if (elements.teamsJoinedCount) elements.teamsJoinedCount.textContent = currentUser.joinedTeams.length;
    if (elements.myTeamsCount) elements.myTeamsCount.textContent = currentUser.joinedTeams.length;
    
    unreadNotificationCount = currentUser.notifications ? currentUser.notifications.filter(n => !n.read).length : 0;
    updateNotificationBadge();

    updateUserAvatar();
}

function updateUserAvatar() { 
    const s = document.getElementById('userAvatar');
    const l = document.getElementById('profileAvatarLarge'); 
    if(!s || !l || !currentUser) return; 
    
    const i = currentUser.fullName.split(' ').map(n => n[0]).join('').toUpperCase(); 
    [s, l].forEach(el => { 
        if (currentUser.avatarUrl) { 
            el.style.backgroundImage = `url(${currentUser.avatarUrl})`; 
            el.textContent = ''; 
        } else { 
            el.style.backgroundImage = ''; 
            el.textContent = i; 
        } 
    }); 
}

function renderEvents(e, c, j) { 
    const t = document.getElementById(c); 
    if(!t) return; 
    
    t.innerHTML = ''; 
    if (e.length === 0) { 
        t.innerHTML = `<div class="no-data-placeholder"><h3>No events found</h3></div>`; 
        return; 
    } 
    e.forEach((v, i) => t.appendChild(createEventCard(v, i, j))); 
}

function createEventCard(e, i, j) { 
    const d = document.createElement('div'); 
    d.className = 'event-card'; 
    const s = e.team ? `${e.team.members.length}/${e.team.maxSlots} slots` : '', 
          b = e.status ? `<span class="event-status status-live">${e.status}</span>` : e.team ? `<span class="event-slots">${s}</span>` : '', 
          c = `difficulty-${(e.difficulty || 'intermediate').toLowerCase()}`; 
    let a = ''; 
    if (j && e.team) { 
        a = (e.team.members.length < e.team.maxSlots) ? `<button class="join-btn" onclick="openJoinModal(${i})">Join ${e.team.name}</button>` : `<div class="team-full">Team Full</div>`; 
        if (e.difficulty) a += `<span class="difficulty-badge ${c}">${e.difficulty}</span>`; 
    } 
    d.innerHTML = `<div class="event-header"><div class="event-emoji">${e.emoji}</div>${b}</div><h3 class="event-title">${e.name}</h3><div class="event-details"><div class="event-detail"><span>📅</span><span>${e.date}</span></div><div class="event-detail"><span>🕒</span><span>${e.time}</span></div><div class="event-detail"><span>📍</span><span>${e.location}</span></div></div>${a ? `<div class="event-actions">${a}</div>` : ''}`; 
    return d; 
}

function openJoinModal(i) { 
    currentEventIndex = i; 
    const event = upcomingEvents[i]; 
    
    logDebug('Opening modal for event index:', i);
    logDebug('Event data:', event);
    logDebug('Event ID:', event?.id);
    logDebug('Total events:', upcomingEvents.length);
    
    if (!event) {
        showNotification('Event not found. Please refresh the page.', 'error');
        return;
    }
    
    if (!event.team) {
        showNotification('Team information not available for this event.', 'error');
        return;
    }
    
    const modalTitle = document.getElementById('modalTitle');
    const eventInfo = document.getElementById('eventInfo');
    const requirementsList = document.getElementById('requirementsList');
    const membersList = document.getElementById('membersList');
    
    if (modalTitle) modalTitle.textContent = `Join ${event.team.name}`;
    
    if (eventInfo) {
        eventInfo.innerHTML = `
            <div style="display:flex;align-items:center;gap:15px;margin-bottom:15px">
                <div style="font-size:40px">${event.emoji}</div>
                <div>
                    <h3 style="margin:0;font-size:20px">${event.name}</h3>
                    <p style="margin:0;color:#718096">${event.category} • ${event.difficulty}</p>
                </div>
            </div>
        `;
    }
    
    if (requirementsList) {
        requirementsList.innerHTML = `
            <li>• Min Reg Year: ${event.team.requirements.minRegNumber}</li>
            <li>• Min Experience: ${event.team.requirements.minExperience} years</li>
        `;
    }
    
    if (membersList) {
        membersList.innerHTML = '';
        event.team.members.forEach(member => {
            const d = document.createElement('div');
            d.className = 'member-item';
            d.innerHTML = `
                <div class="member-avatar">${member.split(' ').map(n => n[0]).join('')}</div>
                <span>${member}</span>
            `;
            membersList.appendChild(d);
        });
    }
    
    if (currentUser) {
        const applicantName = document.getElementById('applicantName');
        const applicantRegNumber = document.getElementById('applicantRegNumber');
        const applicantEmail = document.getElementById('applicantEmail');
        
        if (applicantName) applicantName.value = currentUser.fullName;
        if (applicantRegNumber) applicantRegNumber.value = currentUser.studentID;
        if (applicantEmail) applicantEmail.value = currentUser.email;
    }
    
    const joinModal = document.getElementById('joinModal');
    if (joinModal) joinModal.classList.add('active');
}

function closeJoinModal() { 
    const joinModal = document.getElementById('joinModal');
    const applicationForm = document.getElementById('applicationForm');
    
    if (joinModal) joinModal.classList.remove('active');
    if (applicationForm) applicationForm.reset();
    currentEventIndex = null; 
}

// Updated showSection function - now deprecated in favor of navigateTo
function showSection(s) {
    const sectionToRoute = {
        'dashboardSection': '/dashboard',
        'upcomingSection': '/events/upcoming',
        'ongoingSection': '/events/ongoing', 
        'pastSection': '/events/past',
        'myTeamsSection': '/teams',
        'profileSection': '/profile'
    };
    
    const route = sectionToRoute[s] || '/dashboard';
    navigateTo(route);
}

function renderMyTeams() { 
    const c = document.getElementById('myTeamsGrid'); 
    if (!c) return;
    
    if (!currentUser || currentUser.joinedTeams.length === 0) { 
        c.innerHTML = `<div class="no-data-placeholder"><h3>No Teams Joined Yet</h3></div>`; 
        return; 
    } 
    
    c.innerHTML = ''; 
    currentUser.joinedTeams.forEach(t => { 
        const d = document.createElement('div'); 
        d.className = 'team-card'; 
        d.innerHTML = `
            <div class="team-card-header">
                <div class="team-card-emoji">${t.emoji}</div>
                <h3>${t.teamName}</h3>
            </div>
            <div class="team-card-body">
                <p><strong>Event:</strong> ${t.eventName}</p>
            </div>
            <div class="team-card-footer">
                <button class="chat-btn" onclick="openTeamChat('${t.teamName}')">Team Chat</button>
                <button class="leave-btn" onclick="handleLeaveTeam('${t.teamName}')">Leave Team</button>
            </div>
        `; 
        c.appendChild(d); 
    }); 
}

function renderProfile() { 
    if (!currentUser) return; 
    
    const elements = {
        profileFullName: document.getElementById('profileFullName'),
        profileRegNumber: document.getElementById('profileRegNumber'),
        profileEmail: document.getElementById('profileEmail'),
        profileMobileNumber: document.getElementById('profileMobileNumber')
    };
    
    if (elements.profileFullName) elements.profileFullName.textContent = currentUser.fullName;
    if (elements.profileRegNumber) elements.profileRegNumber.textContent = currentUser.studentID;
    if (elements.profileEmail) elements.profileEmail.textContent = currentUser.email;
    if (elements.profileMobileNumber) elements.profileMobileNumber.textContent = currentUser.mobileNumber || "Not provided";
    
    updateUserAvatar(); 
}

function renderNotifications() {
    const notificationList = document.getElementById('notificationList');
    if (!notificationList) return;
    
    notificationList.innerHTML = '';
    
    if (!currentUser || currentUser.notifications.length === 0) {
        notificationList.innerHTML = `<li class="notification-item-empty">No new notifications</li>`;
        return;
    }
    
    currentUser.notifications.forEach((notification, index) => {
        const notificationItem = document.createElement('li');
        notificationItem.className = 'notification-item';
        
        const isUnread = index < unreadNotificationCount;
        if (isUnread) {
            notificationItem.classList.add('unread');
        }
        
        notificationItem.innerHTML = `
            <div class="notification-item-icon">${notification.icon}</div>
            <div class="notification-item-content">
                <h4>${notification.title}</h4>
                <p>${notification.body}</p>
                <small class="notification-time">${formatNotificationTime(notification.timestamp)}</small>
            </div>
            ${isUnread ? '<div class="unread-indicator"></div>' : ''}
        `;
        
        notificationList.appendChild(notificationItem);
    });
}

function filterEvents(e) { 
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    
    const s = searchInput ? searchInput.value.toLowerCase() : '';
    const c = categoryFilter ? categoryFilter.value : 'all';
    
    return e.filter(v => {
        const matchesSearch = v.name.toLowerCase().includes(s) || v.category.toLowerCase().includes(s);
        const matchesCategory = c === 'all' || v.category.toLowerCase() === c;
        return matchesSearch && matchesCategory;
    });
}

function showNotification(m, t = 'success') { 
    const n = document.getElementById('notification'); 
    if (!n) return;
    
    n.textContent = m; 
    n.className = `notification ${t} show`; 
    setTimeout(() => n.classList.remove('show'), 3000); 
}

// --- API CONNECTION TESTING ---
async function testAPIConnection() {
    try {
        logDebug('Testing API connection...');
        const result = await apiRequest('/api/events');
        
        if (result.success) {
            const events = result.data;
            logDebug('API Response successful');
            logDebug('Events data:', events);
            
            if (events && events.length > 0) {
                logDebug('First event structure:', events[0]);
                logDebug('Event has ID?', 'id' in events[0], events[0].id);
                logDebug('Event has team?', 'team' in events[0], events[0].team);
            }
            showNotification('API connection successful!', 'success');
        } else {
            logError('API connection failed:', result.error);
            showNotification('API connection failed: ' + result.error, 'error');
        }
    } catch (error) {
        logError('API connection test failed:', error);
        showNotification('API connection test failed', 'error');
    }
}

// --- DEBUGGING HELPER ---
window.addEventListener('load', function() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        const testButton = document.createElement('button');
        testButton.textContent = 'Test API';
        testButton.style.position = 'fixed';
        testButton.style.top = '10px';
        testButton.style.left = '10px';
        testButton.style.zIndex = '9999';
        testButton.style.background = '#667eea';
        testButton.style.color = 'white';
        testButton.style.border = 'none';
        testButton.style.padding = '10px';
        testButton.style.borderRadius = '5px';
        testButton.style.cursor = 'pointer';
        testButton.onclick = testAPIConnection;
        document.body.appendChild(testButton);
    }
});

// --- GLOBAL ERROR HANDLER ---
window.addEventListener('error', function(e) {
    logError('Global JavaScript error:', e.error);
    showNotification('An error occurred. Please refresh the page.', 'error');
});

window.addEventListener('unhandledrejection', function(e) {
    logError('Unhandled promise rejection:', e.reason);
    showNotification('A network error occurred. Please check your connection.', 'error');
});

// --- TOKEN MONITORING ---
// Check token validity periodically when app is active
setInterval(() => {
    if (currentUser && !getAccessToken()) {
        logDebug('Access token invalid, attempting refresh');
        refreshTokenIfPossible();
    }
}, 60000); // Check every minute

// Handle page visibility changes for token management
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUser) {
        // Page became visible, check if token needs refresh
        const token = getAccessToken();
        if (!token) {
            refreshTokenIfPossible();
        }
    }
});

// Start the app
document.addEventListener('DOMContentLoaded', init);
