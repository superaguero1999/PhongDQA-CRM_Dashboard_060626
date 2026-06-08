const AuthService = (() => {
  const SESSION_KEY = 'crm_editor_auth';

  function isEditor() {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  }

  function login(password) {
    if (password === APP_CONFIG.editorPassword) {
      sessionStorage.setItem(SESSION_KEY, '1');
      return true;
    }
    return false;
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  // Áp dụng trạng thái quyền lên DOM: ẩn/hiện các element có data-editor-only / data-viewer-only
  function applyRoleUI() {
    const editor = isEditor();
    document.querySelectorAll('[data-editor-only]').forEach(el => {
      el.style.display = editor ? '' : 'none';
    });
    document.querySelectorAll('[data-viewer-only]').forEach(el => {
      el.style.display = editor ? 'none' : '';
    });
    const badge = document.getElementById('role-badge');
    if (badge) {
      badge.textContent = editor ? 'Editor' : 'Viewer';
      badge.className = editor
        ? 'px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800'
        : 'px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-700';
    }
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.style.display = editor ? '' : 'none';
  }

  return { isEditor, login, logout, applyRoleUI };
})();
