/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import Login from './pages/Login.tsx';
import Otp from './pages/Otp.tsx';
import NotFound from './pages/NotFound.tsx';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

render(
  () => (
    <Router>
      <Route path="/" component={Login} />
      <Route path="/login" component={Login} />
      <Route path="/otp" component={Otp} />
      <Route path="*" component={NotFound} />
    </Router>
  ),
  root,
);
