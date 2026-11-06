/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import Login from './pages/Login.tsx';
import Otp from './pages/Otp.tsx';
import BindOtp from './pages/BindOtp.tsx';
import BindStart from './pages/BindStart.tsx';
import LostKey from './pages/LostKey.tsx';
import LogoutDone from './pages/LogoutDone.tsx';
import PasswordReset from './pages/PasswordReset.tsx';
import PasswordSet from './pages/PasswordSet.tsx';
import Register from './pages/Register.tsx';
import VerifyEmail from './pages/VerifyEmail.tsx';
import NotFound from './pages/NotFound.tsx';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

render(
  () => (
    // BASE_URL is vite's `base` (/ui/v2/login/)
    <Router base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Route path="/" component={Login} />
      <Route path="/login" component={Login} />
      <Route path="/otp" component={Otp} />
      <Route path="/yubikey" component={BindStart} />
      <Route path="/yubikey/otp" component={BindOtp} />
      <Route path="/yubikey/lost" component={LostKey} />
      <Route path="/register" component={Register} />
      <Route path="/password/reset" component={PasswordReset} />
      <Route path="/password/set" component={PasswordSet} />
      <Route path="/verify" component={VerifyEmail} />
      <Route path="/logout/done" component={LogoutDone} />
      <Route path="*" component={NotFound} />
    </Router>
  ),
  root,
);
