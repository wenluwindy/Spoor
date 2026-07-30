import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUserProfile } from '../../src/hooks/useUserProfile';

describe('useUserProfile', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('返回默认值', () => {
    const { result } = renderHook(() => useUserProfile());
    expect(result.current.userName).toBe('Main Library');
    expect(result.current.userRole).toBe('Focus Mode Active');
    expect(result.current.userAvatar).toContain('LOGO');
  });

  it('从 localStorage 读取已有值', () => {
    localStorage.setItem('user_name', '自定义用户');
    localStorage.setItem('user_role', '专注写作');
    localStorage.setItem('user_avatar', 'https://example.com/avatar.png');

    const { result } = renderHook(() => useUserProfile());
    expect(result.current.userName).toBe('自定义用户');
    expect(result.current.userRole).toBe('专注写作');
    expect(result.current.userAvatar).toBe('https://example.com/avatar.png');
  });

  it('更新 userName 后同步写入 localStorage', () => {
    const { result } = renderHook(() => useUserProfile());

    act(() => {
      result.current.setUserName('新名字');
    });

    expect(result.current.userName).toBe('新名字');
    expect(localStorage.getItem('user_name')).toBe('新名字');
  });

  it('更新 userRole 后同步写入 localStorage', () => {
    const { result } = renderHook(() => useUserProfile());

    act(() => {
      result.current.setUserRole('休息中');
    });

    expect(result.current.userRole).toBe('休息中');
    expect(localStorage.getItem('user_role')).toBe('休息中');
  });

  it('更新 userAvatar 后同步写入 localStorage', () => {
    const { result } = renderHook(() => useUserProfile());

    act(() => {
      result.current.setUserAvatar('https://new-avatar.png');
    });

    expect(result.current.userAvatar).toBe('https://new-avatar.png');
    expect(localStorage.getItem('user_avatar')).toBe('https://new-avatar.png');
  });
});
