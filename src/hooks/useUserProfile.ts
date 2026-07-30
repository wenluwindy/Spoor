import { useState, useEffect } from 'react';
import logoUrl from '../../LOGO.png';

const LEGACY_DEFAULT_AVATAR = 'https://lh3.googleusercontent.com/aida-public/AB6AXuAJ4QVDvA9fTIQoBUT7DMYuMx4lar18Lu2yQ4F-BA02ETKD3F685obhnMMZ1DTSPgIGtayR6TnhxxI6xPnMhkIfVwIw8pUoiCCKugCt50m261Esqg2-55XI-P4ZSBmpCF6WZeh0zZYF25ixFg1yLaNs5Xysi48cS0GvzZsLD-Z_8zoH7WpKlehQuPAUPWjbyO09MlCOEVrth2zGKWn3MGyHKx3VZmQ2hgrMhzuBmSy6XFRKlRS29CPcZsqDQJ-BLENv8p6ldZ5UsiM';
const DEFAULT_AVATAR = logoUrl;

function resolveStoredAvatar() {
  const saved = localStorage.getItem('user_avatar');
  return !saved || saved === LEGACY_DEFAULT_AVATAR ? DEFAULT_AVATAR : saved;
}

export function useUserProfile() {
  const [userName, setUserName] = useState(() => localStorage.getItem('user_name') || 'Main Library');
  const [userRole, setUserRole] = useState(() => localStorage.getItem('user_role') || 'Focus Mode Active');
  const [userAvatar, setUserAvatar] = useState(resolveStoredAvatar);

  useEffect(() => {
    localStorage.setItem('user_name', userName);
    localStorage.setItem('user_role', userRole);
    localStorage.setItem('user_avatar', userAvatar);
  }, [userName, userRole, userAvatar]);

  return { userName, setUserName, userRole, setUserRole, userAvatar, setUserAvatar };
}
