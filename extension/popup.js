// The toolbar popup: sign-in status, open the editor, sign out.
const call = (method) => chrome.runtime.sendMessage({ method }).then((r) => (r?.error ? Promise.reject(new Error(r.error)) : r?.value));
const st = document.getElementById('st');
const out = document.getElementById('out');

function show(s) {
  st.textContent = '';
  if (s.plan) {
    st.append('Signed in to ChatGPT', s.email ? ' as ' : '');
    if (s.email) {
      const b = document.createElement('b');
      b.textContent = s.email;
      st.append(b);
    }
    st.append('. The IngrainedCut chat runs on your ChatGPT plan.');
  } else if (s.signedIn) st.textContent = 'Signed in, but ChatGPT plan use was not allowed. Sign in again from the editor.';
  else st.textContent = 'Open the editor, pick ChatGPT in the AI panel and click Continue with ChatGPT.';
  out.hidden = !s.signedIn;
}

call('status').then(show, (e) => (st.textContent = e.message));
document.getElementById('open').onclick = () => call('openSite').then(() => window.close());
out.onclick = () => call('signOut').then(show);
