import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api } from '../../api.js';

export default function CopilotTerminal({ resource, id, onDone, canControl = true }) {
  const host = useRef(null);
  const onDoneRef = useRef(onDone);
  const [status, setStatus] = useState('running');
  const [error, setError] = useState('');
  const [operator, setOperator] = useState(() => localStorage.getItem('operator') ?? '');
  onDoneRef.current = onDone;

  useEffect(() => {
    const terminal = new Terminal({ convertEol: true, cursorBlink: true, disableStdin: !canControl, fontSize: 13, scrollback: 3000 });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    fit.fit();
    terminal.focus();
    let cursor = 0;
    let alive = true;
    let complete = false;
    let queued = '';
    let sendTimer = null;
    let pollBusy = false;
    let terminalReady = false;

    const sendInput = async () => {
      sendTimer = null;
      const data = queued;
      queued = '';
      if (!data || !alive) return;
      try {
        await api('POST', `${resource}/${id}/input`, { data });
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    const input = canControl ? terminal.onData((data) => {
      queued += data;
      if (!sendTimer) sendTimer = setTimeout(sendInput, 30);
    }) : null;

    const resize = () => {
      fit.fit();
      if (terminalReady && canControl) {
        api('POST', `${resource}/${id}/resize`, { cols: terminal.cols, rows: terminal.rows })
          .catch((e) => { if (alive) setError(e.message); });
      }
    };
    const poll = async () => {
      if (!alive || pollBusy) return;
      pollBusy = true;
      try {
        const session = await api('GET', `${resource}/${id}?offset=${cursor}`);
        if (!alive) return;
        if (session.interactive && !terminalReady) {
          terminalReady = true;
          resize();
        }
        if (session.reset) terminal.reset();
        if (session.output) terminal.write(session.output);
        cursor = session.cursor;
        setStatus(session.status);
        if (session.status !== 'running' && !complete) {
          complete = true;
          if (session.status === 'failed') setError(session.error || 'Copilot a terminé en erreur.');
          onDoneRef.current?.(session);
        }
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        pollBusy = false;
      }
    };
    poll();
    const timer = setInterval(poll, 400);
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    return () => {
      alive = false;
      clearInterval(timer);
      clearTimeout(sendTimer);
      observer.disconnect();
      input?.dispose();
      terminal.dispose();
    };
  }, [resource, id, canControl]);

  const finish = async () => {
    setError('');
    try {
      await api('POST', `${resource}/${id}/finish`);
    } catch (e) {
      setError(e.message);
    }
  };

  const cancel = async () => {
    setError('');
    try {
      await api('POST', `${resource}/${id}/cancel`);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="copilot-terminal">
      <div className="row">
        <span className="muted">{status === 'running' ? 'Copilot actif — répondez dans le terminal si nécessaire.' : `Session ${status}`}</span>
        {canControl && (
          <label className="muted">Opérateur{' '}
            <input value={operator} placeholder="opérateur" size={12} onChange={(e) => {
              setOperator(e.target.value);
              localStorage.setItem('operator', e.target.value.trim());
            }} />
          </label>
        )}
        {status === 'running' && canControl && (
          <span>
            <button onClick={finish}>Terminer la session</button>{' '}
            <button onClick={cancel}>Arrêter</button>
          </span>
        )}
      </div>
      <div className="copilot-terminal-screen" ref={host} />
      {error && <p className="err">{error}</p>}
    </div>
  );
}
