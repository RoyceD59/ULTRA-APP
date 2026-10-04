import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { installNativeQueryRecovery } from './nativeQueryRecovery';

export function installQueryConnectivity() {
  const stop = installNativeQueryRecovery(listener => NetInfo.addEventListener(listener));
  // iOS may not deliver network changes while backgrounded. Refresh the
  // native snapshot on return, without optimistic online status on failure.
  const foreground = AppState.addEventListener('change', state => {
    if (state === 'active') void NetInfo.refresh().catch(() => undefined);
  });
  return () => { foreground.remove(); stop(); };
}