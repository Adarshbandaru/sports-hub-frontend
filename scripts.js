// --- GLOBAL VARIABLES ---
let currentUser = null;
let currentEventIndex = null;
let upcomingEvents = []; 
let websocket = null;
let currentChatTeam = null;

const ongoingEvents = [ 
    { id: 5, name: "National Volleyball Championship", date: "2025-09-07", emoji: "🏐" }, 
    { id: 6, name: "Engineering Football League", date: "2025-09-07", emoji: "⚽" } 
];

const pastEvents = [ 
    { id: 7, name: "Boys Basketball Tournament", date: "2025-08-22", emoji: "🏀" }, 
    { id: 8, name: "Girls Hockey League", date: "2025-08-15", emoji: "🏑" } 
];

// --- DATA PERSISTENCE ---
function saveData() { 
    localStorage.setItem('sportsHubUser', JSON.stringify(currentUser)); 
}

function loadData() { 
    const d = localStorage.getItem('sportsHubUser'); 
    if (d) currentUser = JSON.parse(d); 
}

// --- WEBSOCKET FUNCTIONS ---
function initializeWebSocket() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        return; // Already connected
    }
    
    websocket = new WebSocket('wss://sportshub-backend-fkye.onrender.com');
    
    websocket.onopen = function() {
        console.log('Connected to WebSocket server');
        updateChatStatus('connected');
    };
    
    websocket.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'message') {
                displayChatMessage(data);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
    
    websocket.onclose = function() {
        console.log('WebSocket connection closed');
        updateChatStatus('disconnected');
        // Attempt to reconnect after 3 seconds
        setTimeout(initializeWebSocket, 3000);
    };
    
    websocket.onerror = function(error) {
        console.error('WebSocket error:', error);
        updateChatStatus('disconnected');
    };
}

function joinTeamChat(teamName) {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        initializeWebSocket();
        // Wait for connection and then join
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

function openTeamChat(teamName) {
    const chatModal = document.getElementById('chatModal');
    const chatModalTitle = document.getElementById('chatModalTitle');
    const chatMessages = document.getElementById('chatMessages');
    
    chatModalTitle.textContent = `${teamName} Chat`;
    chatMessages.innerHTML = '<div class="chat-status" id="chatStatus">Connecting to chat...</div>';
    
    // Join the team chat room
    joinTeamChat(teamName);
    
    // Show the modal
    chatModal.classList.add('active');
}

function closeChatModal() {
    const chatModal = document.getElementById('chatModal');
    chatModal.classList.remove('active');
    currentChatTeam = null;
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
    setupEventListeners();
    setupChatEventListeners();
    loadData();
    if (currentUser) { 
        showApp();
        initializeWebSocket();
    } else { 
        showAuth();
    }
}

function showAuth() {
    document.getElementById('authContainer').style.display = 'flex';
    document.getElementById('mainContainer').style.display = 'none';
}

async function showApp() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    
    await fetchAndRenderUpcomingEvents();
    renderEvents(ongoingEvents, 'ongoingEventsGrid');
    renderEvents(pastEvents, 'pastEventsGrid');
    updateUIForUser();
}

// --- FETCH DATA FROM BACKEND ---
async function fetchAndRenderUpcomingEvents() {
    try {
        const response = await fetch('https://sportshub-backend-fkye.onrender.com/api/events');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        upcomingEvents = await response.json();
        renderEvents(filterEvents(upcomingEvents), 'upcomingEventsGrid', true);
        // Update dashboard counts after fetching
        document.querySelector('.action-card:nth-child(1) .count').textContent = upcomingEvents.length;
        document.querySelector('.stat-card:nth-child(3) p').textContent = upcomingEvents.length;
    } catch (error) { 
        console.error("Could not fetch upcoming events:", error);
    }
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    setupAuthTabs();
    setupFormValidation();
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('applicationForm').addEventListener('submit', handleApplication);
    document.getElementById('searchInput').addEventListener('input', () => renderEvents(filterEvents(upcomingEvents), 'upcomingEventsGrid', true));
    document.getElementById('categoryFilter').addEventListener('change', () => renderEvents(filterEvents(upcomingEvents), 'upcomingEventsGrid', true));
    document.getElementById('changePhotoButton').addEventListener('click', handleChangePhoto);
    document.getElementById('logoutButton').addEventListener('click', handleLogout);
    document.getElementById('editProfileButton').addEventListener('click', handleEditProfileClick);
    
    const notifIcon = document.getElementById('notificationIcon');
    const notifPanel = document.getElementById('notificationPanel');
    notifIcon.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        const isVisible = notifPanel.classList.toggle('show'); 
        if (isVisible) renderNotifications(); 
    });
    window.addEventListener('click', (e) => { 
        if (e.target.id === 'joinModal') closeJoinModal(); 
        if (e.target.id === 'chatModal') closeChatModal();
        if (notifIcon && !notifIcon.contains(e.target)) {
            notifPanel.classList.remove('show');
        } 
    });
}

function setupChatEventListeners() {
    // Chat form submission
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
    
    // Close chat modal button
    const closeChatBtn = document.getElementById('closeChatModalBtn');
    if (closeChatBtn) {
        closeChatBtn.addEventListener('click', closeChatModal);
    }
}

// --- AUTHENTICATION HANDLERS ---
async function handleLogin(e) {
    e.preventDefault();
    if (!validateLoginEmail() || !validateLoginPassword()) {
        return showNotification('Please fix the errors above', 'error');
    }
    const formData = {
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
    };
    try {
        const response = await fetch('https://sportshub-backend-fkye.onrender.com/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);

        currentUser = {
            ...result.user,
            avatarUrl: null,
            joinedTeams: [],
            notifications: [{ icon: "🏆", title: `Welcome back, ${result.user.fullName}!`, body: "Explore events and join the fun." }]
        };
        saveData();
        showApp();
        initializeWebSocket();
        showNotification(result.message, 'success');
    } catch (error) {
        console.error('Login failed:', error);
        showNotification(error.message, 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const fields = ['regFullName', 'regStudentID', 'regEmail', 'regPassword', 'regConfirmPassword'];
    const allValid = fields.every(id => validateRegisterField(id, document.getElementById(id).value));
    if (!allValid) return showNotification('Please fix the errors above', 'error');
    
    const formData = {
        fullName: document.getElementById('regFullName').value,
        studentID: document.getElementById('regStudentID').value,
        email: document.getElementById('regEmail').value,
        password: document.getElementById('regPassword').value
    };
    try {
        const response = await fetch('https://sportshub-backend-fkye.onrender.com/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        
        showNotification('Registration successful! Please login now.', 'success');
        document.getElementById('loginTab').click();
        document.getElementById('registerForm').reset();
    } catch (error) {
        console.error('Registration failed:', error);
        showNotification(error.message, 'error');
    }
}

function handleLogout() {
    currentUser = null;
    localStorage.removeItem('sportsHubUser');
    if (websocket) {
        websocket.close();
        websocket = null;
    }
    window.location.reload();
}

function handleChangePhoto() {
    if (!currentUser) return;
    const url = prompt("Enter new profile image URL:");
    if (url) {
        currentUser.avatarUrl = url;
        saveData();
        updateUserAvatar();
        showNotification("Profile photo updated!", "success");
    }
}

async function handleEditProfileClick() {
    const profileCard = document.getElementById('profileDetails').closest('.profile-card');
    const editButton = document.getElementById('editProfileButton');
    const isEditing = profileCard.classList.contains('is-editing');

    if (isEditing) {
        const updatedData = {
            email: currentUser.email,
            fullName: document.getElementById('editProfileFullName').value,
            mobileNumber: document.getElementById('editProfileMobileNumber').value
        };
        try {
            const response = await fetch('https://sportshub-backend-fkye.onrender.com/api/profile/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedData)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message);
            
            currentUser.fullName = result.user.fullName;
            currentUser.mobileNumber = result.user.mobileNumber;
            saveData();
            renderProfile();
            showNotification(result.message, 'success');
        } catch (error) {
            showNotification(error.message, 'error');
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

// --- TEAM & APPLICATION LOGIC ---
async function handleApplication(e) {
    e.preventDefault();
    const event = upcomingEvents[currentEventIndex];
    const applicationData = {
        userFullName: currentUser.fullName,
        userRegNumber: document.getElementById('applicantRegNumber').value,
        userExperience: parseInt(document.getElementById('applicantExperience').value)
    };
    try {
        const response = await fetch(`https://sportshub-backend-fkye.onrender.com/api/events/${event.id}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(applicationData)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        
        currentUser.joinedTeams.push({ eventName: event.name, teamName: event.team.name, emoji: event.emoji });
        saveData();
        await fetchAndRenderUpcomingEvents();
        updateUIForUser();
        closeJoinModal();
        showNotification(result.message, 'success');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

async function handleLeaveTeam(teamName) {
    if (!currentUser || !confirm(`Are you sure you want to leave ${teamName}?`)) return;
    try {
        const response = await fetch(`https://sportshub-backend-fkye.onrender.com/api/teams/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userFullName: currentUser.fullName, teamName })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);

        currentUser.joinedTeams = currentUser.joinedTeams.filter(team => team.teamName !== teamName);
        saveData();
        await fetchAndRenderUpcomingEvents();
        updateUIForUser();
        renderMyTeams();
        showNotification(result.message, 'success');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// --- FORM VALIDATION ---
function setupAuthTabs() { 
    const lT = document.getElementById('loginTab'), rT = document.getElementById('registerTab'), 
          lF = document.getElementById('loginForm'), rF = document.getElementById('registerForm'); 
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
    document.getElementById('loginEmail').addEventListener('input', validateLoginEmail); 
    document.getElementById('loginPassword').addEventListener('input', validateLoginPassword);
    ['regFullName', 'regStudentID', 'regEmail', 'regPassword', 'regConfirmPassword'].forEach(id => { 
        document.getElementById(id).addEventListener('input', (e) => validateRegisterField(id, e.target.value)); 
    });
}

function validateLoginEmail() { 
    const e = document.getElementById('loginEmail'), r = document.getElementById('loginEmailError'); 
    if (!e.value) { setFieldError(e, r, ''); return false; } 
    if (!/^[a-zA-Z0-9]+\.[a-zA-Z0-9]+@college\.edu$/.test(e.value)) { 
        setFieldError(e, r, 'Format: name.surname@college.edu'); return false; 
    } 
    setFieldSuccess(e, r); return true; 
}

function validateLoginPassword() { 
    const p = document.getElementById('loginPassword'), e = document.getElementById('loginPasswordError'); 
    if (!p.value) { setFieldError(p, e, ''); return false; } 
    if (p.value.length < 6) { setFieldError(p, e, 'Password must be >= 6 characters'); return false; } 
    setFieldSuccess(p, e); return true; 
}

function setFieldError(i, e, m) { i.classList.add('error'); e.textContent = m; }
function setFieldSuccess(i, e) { i.classList.remove('error'); e.textContent = ''; }

function validateRegisterField(f, v) { 
    const i = document.getElementById(f), e = document.getElementById(f + 'Error'); 
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
            if (v !== document.getElementById('regPassword').value) { 
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
    document.getElementById('userName').textContent = currentUser.fullName; 
    document.getElementById('welcomeUserName').textContent = currentUser.fullName; 
    document.getElementById('userRegNumber').textContent = currentUser.studentID; 
    document.getElementById('teamsJoinedCount').textContent = currentUser.joinedTeams.length; 
    document.getElementById('myTeamsCount').textContent = currentUser.joinedTeams.length; 
    document.getElementById('notificationBadge').textContent = currentUser.notifications.length; 
    updateUserAvatar(); 
}

function updateUserAvatar() { 
    const s = document.getElementById('userAvatar'), l = document.getElementById('profileAvatarLarge'); 
    if(!s || !l) return; 
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
    d.innerHTML = `<div class="event-header"><div class="event-emoji">${e.emoji}</div>${b}</div><h3 class="event-title">${e.name}</h3><div class="event-details"><div class="event-detail"><span>📅</span><span>${e.date}</span></div><div class="event-detail"><span>🕐</span><span>${e.time}</span></div><div class="event-detail"><span>📍</span><span>${e.location}</span></div></div>${a ? `<div class="event-actions">${a}</div>` : ''}`; 
    return d; 
}

function openJoinModal(i) { 
    currentEventIndex = i; 
    const e = upcomingEvents[i]; 
    console.log('Event data:', e);
    console.log('Event ID:', e.id);
    document.getElementById('modalTitle').textContent = `Join ${e.team.name}`; 
    document.getElementById('eventInfo').innerHTML = `<div style="display:flex;align-items:center;gap:15px;margin-bottom:15px"><div style="font-size:40px">${e.emoji}</div><div><h3 style="margin:0;font-size:20px">${e.name}</h3><p style="margin:0;color:#718096">${e.category} • ${e.difficulty}</p></div></div>`; 
    document.getElementById('requirementsList').innerHTML = `<li>• Min Reg Year: ${e.team.requirements.minRegNumber}</li><li>• Min Experience: ${e.team.requirements.minExperience} years</li>`; 
    const m = document.getElementById('membersList'); 
    m.innerHTML = ''; 
    e.team.members.forEach(b => { 
        const d = document.createElement('div'); 
        d.className = 'member-item'; 
        d.innerHTML = `<div class="member-avatar">${b.split(' ').map(n => n[0]).join('')}</div><span>${b}</span>`; 
        m.appendChild(d); 
    }); 
    if (currentUser) { 
        document.getElementById('applicantName').value = currentUser.fullName; 
        document.getElementById('applicantRegNumber').value = currentUser.studentID; 
        document.getElementById('applicantEmail').value = currentUser.email; 
    } 
    document.getElementById('joinModal').classList.add('active'); 
}

function closeJoinModal() { 
    document.getElementById('joinModal').classList.remove('active'); 
    document.getElementById('applicationForm').reset(); 
    currentEventIndex = null; 
}

function showSection(s) { 
    document.querySelectorAll('.section').forEach(e => e.classList.remove('active')); 
    document.getElementById(s).classList.add('active'); 
    switch (s) { 
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
    } 
}

function renderMyTeams() { 
    const c = document.getElementById('myTeamsGrid'); 
    if (!currentUser || currentUser.joinedTeams.length === 0) { 
        c.innerHTML = `<div class="no-data-placeholder"><h3>No Teams Joined Yet</h3></div>`; 
        return; 
    } 
    c.innerHTML = ''; 
    currentUser.joinedTeams.forEach(t => { 
        const d = document.createElement('div'); 
        d.className = 'team-card'; 
        d.innerHTML = `<div class="team-card-header"><div class="team-card-emoji">${t.emoji}</div><h3>${t.teamName}</h3></div><div class="team-card-body"><p><strong>Event:</strong> ${t.eventName}</p></div><div class="team-card-footer"><button class="chat-btn" onclick="openTeamChat('${t.teamName}')">Team Chat</button><button class="leave-btn" onclick="handleLeaveTeam('${t.teamName}')">Leave Team</button></div>`; 
        c.appendChild(d); 
    }); 
}

function renderProfile() { 
    if (!currentUser) return; 
    document.getElementById('profileFullName').textContent = currentUser.fullName; 
    document.getElementById('profileRegNumber').textContent = currentUser.studentID; 
    document.getElementById('profileEmail').textContent = currentUser.email; 
    document.getElementById('profileMobileNumber').textContent = currentUser.mobileNumber || "Not provided"; 
    updateUserAvatar(); 
}

function renderNotifications() { 
    const l = document.getElementById('notificationList'); 
    l.innerHTML = ''; 
    if (!currentUser || currentUser.notifications.length === 0) { 
        l.innerHTML = `<li class="notification-item-empty">No new notifications</li>`; 
        return; 
    } 
    currentUser.notifications.forEach(n => { 
        const i = document.createElement('li'); 
        i.className = 'notification-item'; 
        i.innerHTML = `<div class="notification-item-icon">${n.icon}</div><div class="notification-item-content"><h4>${n.title}</h4><p>${n.body}</p></div>`; 
        l.appendChild(i); 
    }); 
}

function filterEvents(e) { 
    const s = document.getElementById('searchInput')?.value.toLowerCase() || '', 
          c = document.getElementById('categoryFilter')?.value || 'all'; 
    return e.filter(v => (v.name.toLowerCase().includes(s) || v.category.toLowerCase().includes(s)) && (c === 'all' || v.category.toLowerCase() === c)); 
}

function showNotification(m, t = 'success') { 
    const n = document.getElementById('notification'); 
    n.textContent = m; 
    n.className = `notification ${t} show`; 
    setTimeout(() => n.classList.remove('show'), 3000); 
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
