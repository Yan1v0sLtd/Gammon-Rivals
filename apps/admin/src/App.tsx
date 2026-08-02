import {lazy, Suspense} from 'react';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';

const Admin = lazy(() => import('./Admin'));
const AdminAuthCallback = lazy(() => import('./AdminAuthCallback'));

function LoadingFallback() {
  return (<main
    className="fixed inset-0 grid place-items-center bg-[#0a0f1c]"
    role="status"
    aria-busy="true"
    aria-label="Loading"
  >
    <div
      className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/60"
      aria-hidden="true"
    />
  </main>);
}

export default function App() {
  return (<BrowserRouter>
    <Suspense fallback={<LoadingFallback/>}>
      <Routes>
        <Route path="/" element={<Admin/>}/>
        <Route path="/auth/callback" element={<AdminAuthCallback/>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
    </Suspense>
  </BrowserRouter>);
}
