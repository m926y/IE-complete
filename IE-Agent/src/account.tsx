import { useState } from 'react';
import { ApiError, api, type MeUser } from './api';

const colors = ['#8060a4', '#477eb0', '#53896b', '#bb7955', '#b26c91', '#717db1'];
export function Avatar({ value, name = '', size = 42 }: { value?: string | null; name?: string; size?: number }) {
  const index = /^preset:[1-6]$/.test(value || '') ? Number(value!.slice(-1)) - 1 : 0;
  return value?.startsWith('data:image/')
    ? <img className="account-avatar" src={value} alt="个人头像" width={size} height={size} />
    : <span className="account-avatar" style={{ width: size, height: size, background: colors[index], fontSize: size * .4 }} aria-label="个人头像">{name.slice(0, 1) || '行'}</span>;
}
function message(error: unknown) {
  const texts: Record<string, string> = {
    username_exists: '该用户名已被使用', username_invalid: '用户名须为 3–32 位字母、数字或 _ . -',
    current_password_invalid: '当前密码不正确', password_weak: '新密码至少 10 位，须包含字母和数字',
    password_unchanged: '新密码不能与当前密码相同', avatar_invalid: '请使用 PNG、JPG 或 WebP 图片',
    account_not_managed: '当前平台身份尚未关联工作台账号，请联系安全员', too_many_attempts: '尝试次数过多，请稍后再试',
    account_changed_retry: '账号已发生变更，请重新登录后操作', display_name_invalid: '请输入 1–60 字的姓名或昵称',
  };
  return error instanceof ApiError ? texts[error.code] || '保存失败，请稍后重试' : error instanceof Error ? error.message : '连接失败，请重试';
}

export function AccountProfile({ user, required = false }: { user: MeUser; required?: boolean }) {
  const [username, setUsername] = useState(user.username || '');
  const [name, setName] = useState(user.displayName);
  const [avatar, setAvatar] = useState(user.avatarUrl || 'preset:1');
  const [current, setCurrent] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function upload(file?: File) {
    if (!file) return;
    setError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('请选择不超过 5MB 的 PNG、JPG 或 WebP 图片'); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const context = canvas.getContext('2d'); if (!context) throw new Error('当前浏览器无法处理图片');
      const side = Math.min(bitmap.width, bitmap.height);
      context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
      bitmap.close();
      const data = canvas.toDataURL('image/webp', .8);
      if (data.length > 48000) throw new Error('图片过大，请选择其他图片');
      setAvatar(data);
    } catch { setError('图片无法读取，请重新选择 PNG、JPG 或 WebP 图片'); }
  }
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api('/api/me/account', { method: 'PATCH', body: JSON.stringify({ username, display_name: name, avatar_url: avatar, current_password: current }) });
      setCurrent(''); setNotice('个人信息已保存'); window.dispatchEvent(new Event('claw:account-updated'));
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function changePassword(e: React.FormEvent) {
    e.preventDefault(); setError(''); setNotice('');
    if (password !== confirmation) { setError('两次输入的新密码不一致'); return; }
    setBusy(true);
    try {
      await api('/api/me/password', { method: 'POST', body: JSON.stringify({ current_password: oldPassword, new_password: password }) });
      setOldPassword(''); setPassword(''); setConfirmation('');
      sessionStorage.setItem('account_notice', '密码已更新，请使用新密码登录');
      window.dispatchEvent(new Event('claw:auth-lost')); location.reload();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <section className="account-profile stack">
    <h2>{required ? '设置新密码' : '个人信息'}</h2>
    {required && <p>首次登录，请先更换初始密码。</p>}
    {required && <button className="btn" onClick={async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); location.reload(); }}>退出登录</button>}
    {notice && <div className="alert info" role="status">{notice}</div>}
    {error && <div className="alert warn" role="alert">{error}</div>}
    {!required && <form className="panel stack" onSubmit={saveProfile}>
      <div className="avatar-editor"><Avatar value={avatar} name={name} size={76} /><label className="btn">上传头像<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
      <div className="avatar-presets" aria-label="选择头像颜色">{colors.map((color, i) => <button key={color} type="button" aria-label={`头像样式${i + 1}`} aria-pressed={avatar === `preset:${i + 1}`} style={{ background: color }} onClick={() => setAvatar(`preset:${i + 1}`)} />)}</div>
      <label className="field">用户名<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} required pattern="[a-z0-9_.-]{3,32}" minLength={3} maxLength={32} /></label>
      <label className="field">姓名 / 昵称<input value={name} onChange={e => setName(e.target.value)} maxLength={60} required autoComplete="nickname" /></label>
      {user.authKind !== 'sso' && username !== user.username && <label className="field">当前密码<input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required /></label>}
      <button className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存个人信息'}</button>
    </form>}
    <form className="panel stack" onSubmit={changePassword}>
      <h3>更换密码</h3>
      {user.authKind === 'sso' && <p className="meta">此处修改工作台密码；千问平台密码请在平台账号设置中修改。</p>}
      <label className="field">当前密码<input type="password" autoComplete="current-password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} required={user.authKind !== 'sso'} maxLength={128} /></label>
      <label className="field">新密码<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={10} maxLength={128} placeholder="至少 10 位，包含字母和数字" /></label>
      <label className="field">确认新密码<input type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required minLength={10} maxLength={128} /></label>
      <button className="btn primary" disabled={busy}>{busy ? '更新中…' : '更新密码并重新登录'}</button>
    </form>
  </section>;
}
