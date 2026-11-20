import { environment as productionEnvironment } from './environment.prod';

/** Android Emulator's special alias for the development PC loopback interface. */
export const environment = {
  ...productionEnvironment,
  production: false,
  apiUrl: 'http://10.0.2.2:5047',
  communication: { androidPushConfigured: true },
};
