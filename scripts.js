/**
 * @file scripts.js
 * @description Client-side JavaScript for the SportsHub application.
 * @version 2.0.0 Refactored
 */

// --- CONFIGURATION & CONSTANTS ---
const API_BASE_URL = 'https://sportshub-backend-fkye.onrender.com';

const JWT_CONFIG = {
    ACCESS_TOKEN_KEY: 'accessToken',
    REFRESH_TOKEN_KEY: 'refreshToken',
    TOKEN_EXPIRY_BUFFER: 2 * 60 * 1000, // 2 minutes
    MAX_RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000, // 1 second
};

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


// --- GLOBAL STATE MANAGEMENT ---

/**
 * Centralized application state.
 * All dynamic data should be stored here.
 */
let state = {
    currentUser: null,
    events: {
        all: [],
        upcoming: [],
        ongoing: [],
        past: []
    },
    websockets: {
        chat: null,
        notifications: null
    },
    currentChatTeam: null,
    currentEventIndex: null,
    unreadNotificationCount: 0,
    isTokenRefreshing: false,
    tokenRefreshPromise: null,
    tokenRefreshTimer: null,
};


// --- UTILITY FUNCTIONS ---

/**
 * Logs a debug message to the console for development.
 * @param {string} message - The message to log.
 * @param {*} [data=null] - Optional data to include in the log.
 */
function logDebug(message, data = null) {
    console.log(`[DEBUG] ${message}`, data || '');
}

/**
 * Logs an error message to the console.
 * @param {string} message - The error description.
 * @param {*} [error=null] - The error object or details.
 */
function logError(message, error = null) {
    console.error(`[ERROR] ${message}`, error || '');
}

/**
 * Sanitizes a string to prevent XSS attacks before inserting into the DOM.
 * @param {string} unsafe - The raw string.
 * @returns {string} The sanitized string.
 */
function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Formats an ISO timestamp into a relative time string (e.g., "5m ago").
 * @param {string} timestamp - The ISO 8601 timestamp.
 * @returns {string} A human-readable relative time.
 */
function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const now = new Date();
    const then = new Date(timestamp);
    const diffInMinutes = Math.floor((now - then) / 60000);

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
}


// --- AUTHENTICATION SERVICE ---

/**
 * Manages JWT tokens, sessions, and automatic refresh logic.
 */
const authService = {
    /**
     * Saves tokens to localStorage and schedules the next refresh.
     * @param {string} accessToken
     * @param {string} refreshToken
     */
    saveTokens(accessToken, refreshToken) {
        if (!this.isValidTokenFormat(accessToken)) {
            logError('Attempted to save an invalid access token format.');
            return;
        }
        localStorage.setItem(JWT_CONFIG.ACCESS_TOKEN_KEY, accessToken);
        if (refreshToken) {
            localStorage.setItem(JWT_CONFIG.REFRESH_TOKEN_KEY, refreshToken);
        }
        this.scheduleTokenRefresh(accessToken);
        logDebug('Auth tokens saved.');
    },

    getAccessToken: () => localStorage.getItem(JWT_CONFIG.ACCESS_TOKEN_KEY),
    getRefreshToken: () => localStorage.getItem(JWT_CONFIG.REFRESH_TOKEN_KEY),

    /**
     * Clears all authentication-related data from state and storage.
     */
    clearData() {
        localStorage.removeItem(JWT_CONFIG.ACCESS_TOKEN_KEY);
        localStorage.removeItem(JWT_CONFIG.REFRESH_TOKEN_KEY);
        localStorage.removeItem('sportsHubUser');
        clearTimeout(state.tokenRefreshTimer);
        state.currentUser = null;
        state.isTokenRefreshing = false;
        state.tokenRefreshPromise = null;
        logDebug('Auth data cleared.');
    },

    /**
     * Checks if a token appears to be a valid JWT (three parts).
     * @param {string} token
     * @returns {boolean}
     */
    isValidTokenFormat(token) {
        return token && typeof token === 'string' && token.split('.').length === 3;
    },

    /**
     * Decodes a JWT payload without verifying the signature.
     * @param {string} token
     * @returns {object|null} The decoded payload or null if invalid.
     */
    getTokenPayload(token) {
        try {
            if (!this.isValidTokenFormat(token)) return null;
            return JSON.parse(atob(token.split('.')[1]));
        } catch (error) {
            logError('Error parsing token payload', error);
            return null;
        }
    },

    /**
     * Sets a timer to refresh the token just before it expires.
     * @param {string} token The access token.
     */
    scheduleTokenRefresh(token) {
        clearTimeout(state.tokenRefreshTimer);
        const payload = this.getTokenPayload(token);
        if (!payload || !payload.exp) return;

        const now = Date.now();
        const expiryTime = payload.exp * 1000;
        const refreshTime = expiryTime - JWT_CONFIG.TOKEN_EXPIRY_BUFFER;

        if (refreshTime > now) {
            const delay = refreshTime - now;
            state.tokenRefreshTimer = setTimeout(() => this.refreshToken(), delay);
            logDebug(`Token refresh scheduled in ${Math.round(delay / 60000)} minutes.`);
        } else {
            // Token is already close to expiry, refresh now
            this.refreshToken();
        }
    },

    /**
     * Performs the token refresh API call.
     * @returns {Promise<boolean>} True if refresh was successful, otherwise false.
     */
    async refreshToken() {
        if (state.isTokenRefreshing) {
            return state.tokenRefreshPromise;
        }

        const refreshToken = this.getRefreshToken();
        if (!refreshToken) {
            this.handleAuthExpiry();
            return false;
        }

        logDebug('Attempting to refresh token...');
        state.isTokenRefreshing = true;
        state.tokenRefreshPromise = apiService.request('/api/auth/refresh', {
                method: 'POST',
                body: JSON.stringify({ refreshToken }),
            })
            .then(result => {
                if (result.success) {
                    this.saveTokens(result.data.accessToken, result.data.refreshToken);
                    logDebug('Token refreshed successfully.');
                    return true;
                } else {
                    throw new Error('Token refresh failed on server.');
                }
            })
            .catch(error => {
                logError('Token refresh failed', error);
                this.handleAuthExpiry();
                return false;
            })
            .finally(() => {
                state.isTokenRefreshing = false;
                state.tokenRefreshPromise = null;
            });

        return state.tokenRefreshPromise;
    },

    /**
     * Handles session expiration by logging the user out and showing the login screen.
     */
    handleAuthExpiry() {
        logDebug('Authentication expired. Handling session termination.');
        this.clearData();
        websocketService.disconnectAll();
        ui.showAuth();
        ui.showNotification('Your session has expired. Please log in again.', 'warning');
    }
};


// --- API SERVICE ---

/**
 * A robust wrapper for all fetch requests to the backend API.
 * Handles automatic token attachment, renewal, and request retries.
 */
const apiService = {
    async request(endpoint, options = {}, retryCount = 0) {
        const url = `${API_BASE_URL}${endpoint}`;
        const publicEndpoints = ['/api/login', '/api/register', '/api/auth/refresh'];

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers,
        };

        if (!publicEndpoints.includes(endpoint)) {
            const token = authService.getAccessToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            } else {
                return { success: false, error: 'Authentication required.' };
            }
        }

        try {
            const response = await fetch(url, { ...options, headers });
            const data = await response.json();

            // Handle expired token: refresh and retry the request
            if (response.status === 401 && data.code === 'TOKEN_EXPIRED' && !publicEndpoints.includes(endpoint)) {
                logDebug('Access token expired, attempting refresh...');
                const refreshed = await authService.refreshToken();
                if (refreshed) {
                    logDebug('Token refreshed, retrying original request.');
                    return this.request(endpoint, options); // Retry the request once
                } else {
                    return { success: false, error: 'Session expired.' };
                }
            }

            if (!response.ok) {
                throw new Error(data.message || `HTTP error! Status: ${response.status}`);
            }

            return { success: true, data };
        } catch (error) {
            // Handle network errors with a simple retry mechanism
            if (retryCount < JWT_CONFIG.MAX_RETRY_ATTEMPTS && error.name === 'TypeError') {
                logDebug(`Network error, retrying... (Attempt ${retryCount + 1})`);
                await new Promise(resolve => setTimeout(resolve, JWT_CONFIG.RETRY_DELAY));
                return this.request(endpoint, options, retryCount + 1);
            }
            logError(`API request to ${endpoint} failed`, error);
            return { success: false, error: error.message };
        }
    }
};


// --- WEBSOCKET SERVICE ---

/**
 * Manages WebSocket connections for real-time chat and notifications.
 */
const websocketService = {
    initChat() {
        if (state.websockets.chat && state.websockets.chat.readyState === WebSocket.OPEN) return;
        
        const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
        state.websockets.chat = new WebSocket(wsUrl);

        state.websockets.chat.onopen = () => logDebug('Chat WebSocket connected.');
        state.websockets.chat.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'message' && data.teamName === state.currentChatTeam) {
                    ui.displayChatMessage(data);
                }
            } catch (error) {
                logError('Error parsing chat message', error);
            }
        };
        state.websockets.chat.onclose = () => {
            logDebug('Chat WebSocket closed. Reconnecting...');
            setTimeout(() => this.initChat(), 3000);
        };
        state.websockets.chat.onerror = (error) => logError('Chat WebSocket error', error);
    },

    initNotifications() {
        if (state.websockets.notifications && state.websockets.notifications.readyState === WebSocket.OPEN) return;
        
        const wsUrl = `${API_BASE_URL.replace(/^http/, 'ws')}/notifications`;
        state.websockets.notifications = new WebSocket(wsUrl);

        state.websockets.notifications.onopen = () => {
            logDebug('Notification WebSocket connected.');
            if (state.currentUser?.email) {
                state.websockets.notifications.send(JSON.stringify({
                    type: 'register',
                    userEmail: state.currentUser.email
                }));
            }
        };
        state.websockets.notifications.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'notification') {
                    this.handleNewNotification(data.notification);
                }
            } catch (error) {
                logError('Error parsing notification', error);
            }
        };
        state.websockets.notifications.onclose = () => {
            logDebug('Notification WebSocket closed. Reconnecting...');
            setTimeout(() => this.initNotifications(), 3000);
        };
        state.websockets.notifications.onerror = (error) => logError('Notification WebSocket error', error);
    },

    /**
     * Handles a new notification from the server.
     * @param {object} notification
     */
    handleNewNotification(notification) {
        if (!state.currentUser) return;
        
        state.currentUser.notifications.unshift(notification);
        if (state.currentUser.notifications.length > 20) {
            state.currentUser.notifications.pop();
        }
        
        state.unreadNotificationCount++;
        ui.updateNotificationBadge();
        persistence.save();
        ui.showNotification(`${notification.title}: ${notification.body}`, 'success');
    },

    /**
     * Sends a chat message to the current team room.
     * @param {string} messageText
     */
    sendChatMessage(messageText) {
        const ws = state.websockets.chat;
        if (!ws || ws.readyState !== WebSocket.OPEN || !state.currentChatTeam) {
            ui.showNotification('Chat is not connected.', 'error');
            return;
        }
        ws.send(JSON.stringify({
            type: 'message',
            sender: state.currentUser.fullName,
            text: messageText,
            teamName: state.currentChatTeam
        }));
    },

    /**
     * Joins a specific team's chat room.
     * @param {string} teamName
     */
    joinTeamChat(teamName) {
        const ws = state.websockets.chat;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            this.initChat(); // Ensure connection is active
            setTimeout(() => this.joinTeamChat(teamName), 1000);
            return;
        }
        state.currentChatTeam = teamName;
        ws.send(JSON.stringify({ type: 'join', teamName }));
    },

    /** Closes all active WebSocket connections. */
    disconnectAll() {
        if (state.websockets.chat) state.websockets.chat.close();
        if (state.websockets.notifications) state.websockets.notifications.close();
    }
};


// --- LOCAL STORAGE PERSISTENCE SERVICE ---

const persistence = {
    save() {
        if (state.currentUser) {
            localStorage.setItem('sportsHubUser', JSON.stringify(state.currentUser));
        }
    },
    load() {
        const userData = localStorage.getItem('sportsHubUser');
        if (userData) {
            try {
                state.currentUser = JSON.parse(userData);
                logDebug('User data loaded from localStorage.');
            } catch {
                localStorage.removeItem('sportsHubUser');
            }
        }
    }
};


// --- EVENT DATA SERVICE ---

/**
 * Handles fetching and processing of event data.
 */
const eventService = {
    /**
     * Fetches all events from the server and categorizes them.
     */
    async fetchAndCategorizeEvents() {
        const result = await apiService.request('/api/events');
        if (result.success) {
            state.events.all = result.data;
            this.categorizeEvents();
            logDebug('Events fetched and categorized.');
        } else {
            ui.showNotification(result.error || 'Failed to load events.', 'error');
        }
    },
    
    /**
     * Categorizes all events into upcoming, ongoing, and past based on their date.
     * This is the new dynamic logic that replaces the old hardcoded lists.
     */
    categorizeEvents() {
        const now = new Date();
        now.setHours(0, 0, 0, 0); // Normalize to the start of the day for comparison

        state.events.upcoming = [];
        state.events.ongoing = [];
        state.events.past = [];

        state.events.all.forEach(event => {
            const [year, month, day] = event.date.split('-').map(Number);
            // new Date() month is 0-indexed, so subtract 1
            const eventDate = new Date(year, month - 1, day);
            
            if (isNaN(eventDate.getTime())) {
                logError('Invalid date format for event:', event);
                return;
            }
            eventDate.setHours(0, 0, 0, 0);

            if (eventDate.getTime() === now.getTime()) {
                state.events.ongoing.push(event);
            } else if (eventDate > now) {
                state.events.upcoming.push(event);
            } else {
                state.events.past.push(event);
            }
        });
        
        // Sort events chronologically
        const sortByDateAsc = (a, b) => new Date(a.date) - new Date(b.date);
        const sortByDateDesc = (a, b) => new Date(b.date) - new Date(a.date);
        
        state.events.upcoming.sort(sortByDateAsc);
        state.events.ongoing.sort(sortByDateAsc);
        state.events.past.sort(sortByDateDesc); // Show most recent past events first
    },
    
    /**
     * Filters a list of events based on search and category inputs.
     * @param {Array<object>} events - The list of events to filter.
     * @returns {Array<object>} The filtered list.
     */
    filterEvents(events) {
        const searchInput = document.getElementById('searchInput');
        const categoryFilter = document.getElementById('categoryFilter');
        
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        const category = categoryFilter ? categoryFilter.value : 'all';
        
        return events.filter(event => {
            const matchesSearch = event.name.toLowerCase().includes(searchTerm) || 
                                  event.category.toLowerCase().includes(searchTerm);
            const matchesCategory = category === 'all' || event.category.toLowerCase() === category;
            return matchesSearch && matchesCategory;
        });
    }
};


// --- UI RENDERING & DOM MANIPULATION ---

/**
 * Manages all updates to the user interface.
 */
const ui = {
    /** Shows the main application and hides the login/register forms. */
    async showApp() {
        document.getElementById('authContainer').style.display = 'none';
        document.getElementById('mainContainer').style.display = 'block';

        this.updateUserUI();
        await eventService.fetchAndCategorizeEvents();
        
        router.handleRoute(); // Render the initial view based on URL
        
        websocketService.initNotifications();
        websocketService.initChat();
    },

    /** Shows the login/register forms and hides the main application. */
    showAuth() {
        document.getElementById('authContainer').style.display = 'flex';
        document.getElementById('mainContainer').style.display = 'none';
    },

    /** Updates all user-specific elements like name, avatar, and stats. */
    updateUserUI() {
        if (!state.currentUser) return;

        const { fullName, studentID, joinedTeams, notifications } = state.currentUser;
        
        document.getElementById('userName').textContent = fullName;
        document.getElementById('welcomeUserName').textContent = fullName;
        document.getElementById('userRegNumber').textContent = studentID;
        document.getElementById('teamsJoinedCount').textContent = joinedTeams.length;
        document.getElementById('myTeamsCount').textContent = joinedTeams.length;

        state.unreadNotificationCount = notifications?.filter(n => !n.read).length || 0;
        this.updateNotificationBadge();
        this.updateUserAvatar();
    },

    /** Updates the user's avatar image or initials. */
    updateUserAvatar() {
        if (!state.currentUser) return;
        const sidebarAvatar = document.getElementById('userAvatar');
        const profileAvatar = document.getElementById('profileAvatarLarge');
        
        const initials = state.currentUser.fullName.split(' ').map(n => n[0]).join('').toUpperCase();
        
        [sidebarAvatar, profileAvatar].forEach(el => {
            if (el) {
                if (state.currentUser.avatarUrl) {
                    el.style.backgroundImage = `url(${state.currentUser.avatarUrl})`;
                    el.textContent = '';
                } else {
                    el.style.backgroundImage = '';
                    el.textContent = initials;
                }
            }
        });
    },

    /**
     * Renders a list of events into a specified container.
     * @param {Array<object>} events - The events to render.
     * @param {string} containerId - The ID of the grid container.
     * @param {boolean} [showJoinButton=false] - Whether to show join/status buttons.
     */
    renderEvents(events, containerId, showJoinButton = false) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = '';
        if (events.length === 0) {
            container.innerHTML = `<div class="no-data-placeholder"><h3>No events found</h3></div>`;
            return;
        }
        
        events.forEach(event => {
            // Find the original index from the 'upcoming' list for the onclick handler
            const originalIndex = showJoinButton ? state.events.upcoming.findIndex(e => e.id === event.id) : -1;
            container.appendChild(this.createEventCard(event, originalIndex, showJoinButton));
        });
    },

    /**
     * Creates and returns a single event card element.
     * @param {object} event - The event data.
     * @param {number} index - The index of the event in the upcoming list.
     * @param {boolean} showJoinButton - Whether to display join actions.
     * @returns {HTMLElement} The event card element.
     */
    createEventCard(event, index, showJoinButton) {
        const card = document.createElement('div');
        card.className = 'event-card';

        const slots = event.team ? `${event.team.members.length}/${event.team.maxSlots} slots` : '';
        const badge = `<span class="event-slots">${slots}</span>`;
        
        let actionsHTML = '';
        if (showJoinButton && event.team && state.currentUser) {
            const isFull = event.team.members.length >= event.team.maxSlots;
            const hasJoined = state.currentUser.joinedTeams.some(t => t.eventId === event.id);
            const difficultyClass = `difficulty-${(event.difficulty || 'intermediate').toLowerCase()}`;
            
            if (hasJoined) {
                actionsHTML = `<div class="team-status-joined">Already Joined</div>`;
            } else if (isFull) {
                actionsHTML = `<div class="team-status-full">Team Full</div>`;
            } else {
                actionsHTML = `<button class="join-btn" onclick="ui.openJoinModal(${index})">Join ${event.team.name}</button>`;
            }
            actionsHTML += `<span class="difficulty-badge ${difficultyClass}">${event.difficulty}</span>`;
        }

        card.innerHTML = `
            <div class="event-header"><div class="event-emoji">${event.emoji}</div>${badge}</div>
            <h3 class="event-title">${escapeHtml(event.name)}</h3>
            <div class="event-details">
                <div class="event-detail"><span>📅</span><span>${event.date}</span></div>
                <div class="event-detail"><span>🕒</span><span>${event.time}</span></div>
                <div class="event-detail"><span>📍</span><span>${escapeHtml(event.location)}</span></div>
            </div>
            ${actionsHTML ? `<div class="event-actions">${actionsHTML}</div>` : ''}
        `;
        return card;
    },

    /** Renders the teams the current user has joined. */
    renderMyTeams() {
        const container = document.getElementById('myTeamsGrid');
        if (!container || !state.currentUser) return;

        const { joinedTeams } = state.currentUser;
        if (!joinedTeams || joinedTeams.length === 0) {
            container.innerHTML = `<div class="no-data-placeholder"><h3>You haven't joined any teams yet.</h3><p>Explore upcoming events to find a team!</p></div>`;
            return;
        }

        container.innerHTML = joinedTeams.map(team => `
            <div class="team-card">
                <div class="team-card-header">
                    <div class="team-card-emoji">${team.emoji}</div>
                    <h3>${escapeHtml(team.teamName)}</h3>
                </div>
                <div class="team-card-body"><p><strong>Event:</strong> ${escapeHtml(team.eventName)}</p></div>
                <div class="team-card-footer">
                    <button class="chat-btn" onclick="ui.openTeamChat('${escapeHtml(team.teamName)}')">Team Chat</button>
                    <button class="leave-btn" onclick="handlers.handleLeaveTeam('${escapeHtml(team.teamName)}')">Leave Team</button>
                </div>
            </div>
        `).join('');
    },

    /** Renders the user's profile information. */
    renderProfile() {
        if (!state.currentUser) return;
        const { fullName, studentID, email, mobileNumber } = state.currentUser;

        document.getElementById('profileFullName').textContent = fullName;
        document.getElementById('profileRegNumber').textContent = studentID;
        document.getElementById('profileEmail').textContent = email;
        document.getElementById('profileMobileNumber').textContent = mobileNumber || "Not provided";
        this.updateUserAvatar();
    },

    /** Renders notifications in the notification panel. */
    renderNotifications() {
        const list = document.getElementById('notificationList');
        if (!list || !state.currentUser) return;

        const { notifications } = state.currentUser;
        if (!notifications || notifications.length === 0) {
            list.innerHTML = `<li class="notification-item-empty">No notifications</li>`;
            return;
        }

        list.innerHTML = notifications.map(n => `
            <li class="notification-item ${!n.read ? 'unread' : ''}">
                <div class="notification-item-icon">${n.icon}</div>
                <div class="notification-item-content">
                    <h4>${escapeHtml(n.title)}</h4>
                    <p>${escapeHtml(n.body)}</p>
                    <small class="notification-time">${formatRelativeTime(n.timestamp)}</small>
                </div>
                ${!n.read ? '<div class="unread-indicator"></div>' : ''}
            </li>
        `).join('');
    },
    
    /** Updates the statistics on the dashboard page. */
    updateDashboardStats() {
        if (!state.currentUser) return;
        document.getElementById('upcomingEventsCount').textContent = state.events.upcoming.length;
        document.getElementById('liveEventsCount').textContent = state.events.ongoing.length;
        document.getElementById('teamsJoinedCount').textContent = state.currentUser.joinedTeams.length;
    },

    /**
     * Opens the "Join Event" modal with details for a specific event.
     * @param {number} eventIndex - The index of the event in `state.events.upcoming`.
     */
    openJoinModal(eventIndex) {
        state.currentEventIndex = eventIndex;
        const event = state.events.upcoming[eventIndex];
        if (!event || !event.team) {
            this.showNotification('Event or team data is missing.', 'error');
            return;
        }

        document.getElementById('modalTitle').textContent = `Join ${event.team.name}`;
        document.getElementById('eventInfo').innerHTML = `
            <div style="display:flex;align-items:center;gap:15px;margin-bottom:15px;">
                <div style="font-size:40px">${event.emoji}</div>
                <div>
                    <h3 style="margin:0;font-size:20px">${escapeHtml(event.name)}</h3>
                    <p style="margin:0;color:#718096">${escapeHtml(event.category)} • ${escapeHtml(event.difficulty)}</p>
                </div>
            </div>`;
        document.getElementById('requirementsList').innerHTML = `
            <li>• Min Reg Year: ${event.team.requirements.minRegNumber}</li>
            <li>• Min Experience: ${event.team.requirements.minExperience} years</li>`;
        
        document.getElementById('membersList').innerHTML = event.team.members.map(member => `
            <div class="member-item">
                <div class="member-avatar">${member.split(' ').map(n=>n[0]).join('')}</div>
                <span>${escapeHtml(member)}</span>
            </div>
        `).join('');
        
        document.getElementById('applicantName').value = state.currentUser.fullName;
        document.getElementById('applicantRegNumber').value = state.currentUser.studentID;
        document.getElementById('applicantEmail').value = state.currentUser.email;

        document.getElementById('joinModal').classList.add('active');
    },

    closeJoinModal() {
        document.getElementById('joinModal').classList.remove('active');
        document.getElementById('applicationForm').reset();
        state.currentEventIndex = null;
    },

    /** Opens the team chat modal and loads its history. */
    async openTeamChat(teamName) {
        state.currentChatTeam = teamName;
        document.getElementById('chatModalTitle').textContent = `${escapeHtml(teamName)} Chat`;
        const chatMessages = document.getElementById('chatMessages');
        chatMessages.innerHTML = '<div class="chat-status">Loading chat history...</div>';
        document.getElementById('chatModal').classList.add('active');
        
        const result = await apiService.request(`/api/chat/${teamName}`);
        chatMessages.innerHTML = '';
        if (result.success) {
            result.data.forEach(msg => this.displayChatMessage(msg));
        } else {
            chatMessages.innerHTML = '<div class="chat-status">Could not load chat history.</div>';
        }
        
        websocketService.joinTeamChat(teamName);
    },

    closeChatModal() {
        document.getElementById('chatModal').classList.remove('active');
        state.currentChatTeam = null;
        // Close and nullify the chat websocket to ensure a fresh connection next time
        if(state.websockets.chat) {
            state.websockets.chat.close();
            state.websockets.chat = null;
        }
    },

    /** Displays a single chat message in the chat window. */
    displayChatMessage(messageData) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;

        const messageDiv = document.createElement('div');
        const isSent = messageData.sender === state.currentUser.fullName;
        messageDiv.className = `chat-message ${isSent ? 'sent' : 'received'}`;
        const timestamp = new Date(messageData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        messageDiv.innerHTML = `
            <div class="sender-info">${isSent ? 'You' : escapeHtml(messageData.sender)} • ${timestamp}</div>
            <div class="message-bubble">${escapeHtml(messageData.text)}</div>
        `;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    },

    /** Shows a temporary notification toast. */
    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type} show`;
        setTimeout(() => notification.classList.remove('show'), 4000);
    },

    /** Updates the unread notification count badge. */
    updateNotificationBadge() {
        const badge = document.getElementById('notificationBadge');
        if (state.unreadNotificationCount > 0) {
            badge.textContent = state.unreadNotificationCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
};


// --- ROUTING SERVICE ---

/**
 * Handles client-side routing and view changes.
 */
const router = {
    init() {
        window.addEventListener('popstate', this.handleRoute);
        document.addEventListener('click', (e) => {
            const routeElement = e.target.closest('[data-route]');
            if (routeElement) {
                e.preventDefault();
                this.navigateTo(routeElement.getAttribute('data-route'));
            }
        });
        this.handleRoute(); // Handle initial route
    },

    navigateTo(path) {
        if (window.location.pathname !== path) {
            history.pushState(null, '', path);
            this.handleRoute();
        }
    },

    handleRoute() {
        const path = window.location.pathname;
        const sectionId = ROUTES[path] || ROUTES['/'];
        
        document.title = ROUTE_TITLES[path] || 'SportsHub';
        
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById(sectionId)?.classList.add('active');
        
        router.loadSectionData(sectionId);
        router.updateActiveNavigation(path);
    },
    
    loadSectionData(sectionId) {
        if (!state.currentUser) return; // Don't load data if not logged in
        
        switch(sectionId) {
            case 'upcomingSection':
                ui.renderEvents(eventService.filterEvents(state.events.upcoming), 'upcomingEventsGrid', true);
                break;
            case 'ongoingSection':
                ui.renderEvents(state.events.ongoing, 'ongoingEventsGrid');
                break;
            case 'pastSection':
                ui.renderEvents(state.events.past, 'pastEventsGrid');
                break;
            case 'myTeamsSection':
                ui.renderMyTeams();
                break;
            case 'profileSection':
                ui.renderProfile();
                break;
            case 'dashboardSection':
                ui.updateDashboardStats();
                break;
        }
    },

    updateActiveNavigation(currentRoute) {
        document.querySelectorAll('.nav-item[data-route]').forEach(item => {
            const route = item.getAttribute('data-route');
            const isActive = (route === currentRoute) || (currentRoute.startsWith('/events') && route === '/events');
            item.classList.toggle('active', isActive);
        });
    }
};


// --- EVENT HANDLERS ---

/**
 * Contains all callback functions for DOM event listeners.
 */
const handlers = {
    async handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        const result = await apiService.request('/api/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        
        if (result.success) {
            authService.saveTokens(result.data.accessToken, result.data.refreshToken);
            state.currentUser = result.data.user;
            persistence.save();
            ui.showApp();
            router.navigateTo('/dashboard');
            ui.showNotification(result.data.message, 'success');
        } else {
            ui.showNotification(result.error, 'error');
        }
    },

    async handleRegister(e) {
        e.preventDefault();
        const fullName = document.getElementById('regFullName').value;
        const studentID = document.getElementById('regStudentID').value;
        const email = document.getElementById('regEmail').value;
        const password = document.getElementById('regPassword').value;
        
        const result = await apiService.request('/api/register', {
            method: 'POST',
            body: JSON.stringify({ fullName, studentID, email, password })
        });
        
        if (result.success) {
            ui.showNotification('Registration successful! Please log in.', 'success');
            document.getElementById('loginTab').click();
            document.getElementById('registerForm').reset();
        } else {
            ui.showNotification(result.error, 'error');
        }
    },

    async handleLogout() {
        await apiService.request('/api/logout', {
            method: 'POST',
            body: JSON.stringify({ refreshToken: authService.getRefreshToken() })
        });
        authService.clearData();
        websocketService.disconnectAll();
        ui.showAuth();
        ui.showNotification('Logged out successfully', 'success');
    },

    async handleApplication(e) {
        e.preventDefault();
        const event = state.events.upcoming[state.currentEventIndex];
        if (!event || !event.id) {
            ui.showNotification('Could not find event data. Please try again.', 'error');
            return;
        }

        const applicationData = {
            userRegNumber: document.getElementById('applicantRegNumber').value,
            userExperience: parseInt(document.getElementById('applicantExperience').value)
        };
        
        const result = await apiService.request(`/api/events/${event.id}/join`, {
            method: 'POST',
            body: JSON.stringify(applicationData)
        });
        
        if (result.success) {
            // Optimistically update UI, then refetch for consistency
            state.currentUser.joinedTeams.push({ 
                eventId: event.id,
                eventName: event.name, 
                teamName: event.team.name, 
                emoji: event.emoji 
            });
            persistence.save();
            await eventService.fetchAndCategorizeEvents();
            ui.updateUserUI();
            router.loadSectionData('upcomingSection'); // Re-render events page
            ui.closeJoinModal();
            ui.showNotification(result.data.message, 'success');
        } else {
            ui.showNotification(result.error, 'error');
        }
    },

    async handleLeaveTeam(teamName) {
        if (!confirm(`Are you sure you want to leave ${teamName}?`)) return;
        
        const result = await apiService.request('/api/teams/leave', {
            method: 'POST',
            body: JSON.stringify({ teamName })
        });
        
        if (result.success) {
            state.currentUser.joinedTeams = state.currentUser.joinedTeams.filter(t => t.teamName !== teamName);
            persistence.save();
            await eventService.fetchAndCategorizeEvents();
            ui.renderMyTeams();
            ui.updateUserUI();
            ui.showNotification(result.data.message, 'success');
        } else {
            ui.showNotification(result.error, 'error');
        }
    },
    
    handleAvatarUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('avatar', file);

        // Use direct fetch for multipart/form-data
        fetch(`${API_BASE_URL}/api/profile/avatar-upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authService.getAccessToken()}` },
            body: formData
        })
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) throw new Error(data.message);
            state.currentUser.avatarUrl = data.avatarUrl;
            persistence.save();
            ui.updateUserAvatar();
            ui.showNotification('Avatar updated successfully!', 'success');
        })
        .catch(error => ui.showNotification(error.message, 'error'));
    },
    
    async markNotificationsAsRead() {
        if (!state.currentUser || state.unreadNotificationCount === 0) return;
        
        const result = await apiService.request('/api/notifications/mark-read', { method: 'POST' });
        if (result.success) {
            state.currentUser.notifications.forEach(n => n.read = true);
            persistence.save();
            state.unreadNotificationCount = 0;
            ui.updateNotificationBadge();
        }
    }
};


// --- INITIALIZATION ---

/**
 * Sets up all initial event listeners for the application.
 */
function setupEventListeners() {
    // Auth Forms
    document.getElementById('loginForm').addEventListener('submit', handlers.handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handlers.handleRegister);
    document.getElementById('loginTab').addEventListener('click', () => {
        document.getElementById('loginTab').classList.add('active');
        document.getElementById('registerTab').classList.remove('active');
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('registerForm').style.display = 'none';
    });
    document.getElementById('registerTab').addEventListener('click', () => {
        document.getElementById('registerTab').classList.add('active');
        document.getElementById('loginTab').classList.remove('active');
        document.getElementById('registerForm').style.display = 'block';
        document.getElementById('loginForm').style.display = 'none';
    });
    
    // Main App
    document.getElementById('logoutButton').addEventListener('click', handlers.handleLogout);
    document.getElementById('sidebarLogout').addEventListener('click', handlers.handleLogout);
    document.getElementById('applicationForm').addEventListener('submit', handlers.handleApplication);
    document.getElementById('avatarUploadInput').addEventListener('change', handlers.handleAvatarUpload);
    document.getElementById('changePhotoButton').addEventListener('click', () => document.getElementById('avatarUploadInput').click());

    // Modals
    document.getElementById('joinModal').addEventListener('click', e => e.target.id === 'joinModal' && ui.closeJoinModal());
    document.getElementById('chatModal').addEventListener('click', e => e.target.id === 'chatModal' && ui.closeChatModal());
    document.getElementById('closeChatModalBtn').addEventListener('click', ui.closeChatModal);
    
    // Chat
    document.getElementById('chatForm').addEventListener('submit', e => {
        e.preventDefault();
        const input = document.getElementById('chatMessageInput');
        if (input.value.trim()) {
            websocketService.sendChatMessage(input.value.trim());
            input.value = '';
        }
    });

    // Notifications
    const notifIcon = document.getElementById('notificationIcon');
    const notifPanel = document.getElementById('notificationPanel');
    notifIcon.addEventListener('click', e => {
        e.stopPropagation();
        const isVisible = notifPanel.classList.toggle('show');
        if (isVisible) {
            ui.renderNotifications();
            handlers.markNotificationsAsRead();
        }
    });
    document.addEventListener('click', e => {
        if (!notifIcon.contains(e.target) && !notifPanel.contains(e.target)) {
            notifPanel.classList.remove('show');
        }
    });

    // Event Filters
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    const debouncedFilter = () => {
        ui.renderEvents(eventService.filterEvents(state.events.upcoming), 'upcomingEventsGrid', true);
    };
    searchInput.addEventListener('input', debouncedFilter);
    categoryFilter.addEventListener('change', debouncedFilter);
}

/**
 * The main entry point for the application.
 */
function main() {
    logDebug('Application initializing...');
    setupEventListeners();
    persistence.load();

    const accessToken = authService.getAccessToken();
    if (accessToken && state.currentUser) {
        logDebug('Found existing session. Starting app.');
        authService.scheduleTokenRefresh(accessToken);
        ui.showApp();
    } else {
        logDebug('No active session. Showing auth page.');
        ui.showAuth();
    }
    router.init();
}

// Start the application once the DOM is fully loaded.
document.addEventListener('DOMContentLoaded', main);
