// ============================================
// Voice Bridge - Login Handler
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const loginBtn = document.getElementById('loginBtn');
    const errorMessage = document.getElementById('errorMessage');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');

    // Check if already authenticated
    checkAuth();

    // Handle form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password) {
            showError('Please enter both username and password');
            return;
        }

        // Show loading state
        loginBtn.classList.add('loading');
        loginBtn.disabled = true;
        hideError();

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.success) {
                // Redirect to call page
                window.location.href = '/call.html';
            } else {
                showError(data.error || 'Invalid credentials');
                loginBtn.classList.remove('loading');
                loginBtn.disabled = false;
            }
        } catch (error) {
            console.error('Login error:', error);
            showError('Connection error. Please try again.');
            loginBtn.classList.remove('loading');
            loginBtn.disabled = false;
        }
    });

    // Check authentication status
    async function checkAuth() {
        try {
            const response = await fetch('/api/check-auth');
            const data = await response.json();

            if (data.authenticated) {
                window.location.href = '/call.html';
            }
        } catch (error) {
            console.error('Auth check error:', error);
        }
    }

    // Show error message
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.add('visible');
    }

    // Hide error message
    function hideError() {
        errorMessage.classList.remove('visible');
    }

    // Clear error on input
    usernameInput.addEventListener('input', hideError);
    passwordInput.addEventListener('input', hideError);

    // Add enter key support
    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loginForm.dispatchEvent(new Event('submit'));
        }
    });
});
