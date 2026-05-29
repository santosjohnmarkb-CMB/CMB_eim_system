import { useState, useEffect } from 'react';
import { ipcInvoke } from '../lib/ipc';

export function useAppVersion() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    ipcInvoke<string>('app:getVersion')
      .then(setVersion)
      .catch(() => setVersion('unknown'));
  }, []);

  return version;
}
