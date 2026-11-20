# Chat, llamadas y reuniones con TaxVision

Integración para Android con el mismo servicio Communication que utiliza `TaxVsion_Front`. Las llamadas son entre usuarios de TaxVision; no son llamadas a números telefónicos.

## Uso

El botón de mensajes de la barra inferior abre **Comunicaciones**. La campana del dashboard abre sus avisos.

- **Chat:** conversaciones propias y grupos existentes, mensajes de texto, historial por cursor y confirmación de lectura. Un mensaje sin acuse conserva su clave al reintentar mientras permanece abierta esa conversación.
- **Mi oficina:** únicamente el preparador activo asignado al cliente. No se expone el directorio de clientes ni el de empleados. Desde allí se inicia un chat o una llamada.
- **Llamadas:** audio o video, historial propio y devolución de llamada. El panel global permite contestar o rechazar desde cualquier sección. Durante la sesión se puede silenciar el micrófono, activar o desactivar la cámara y colgar.
- **Reuniones:** próximas reuniones propias, entrada por ID, código o enlace de invitación, código de acceso y sala de espera. Se reutilizan los transportes Mesh y SFU del CRM. También se reciben las pantallas compartidas por otros participantes.
- **Grabación:** se muestra el estado y se pide consentimiento cuando la oficina solicita grabar. Esta entrega no incorpora los controles de administración/grabación del CRM.
- **Avisos:** centro de notificaciones del servidor y avisos locales Android cuando la aplicación recibe eventos. La activación de permisos se solicita desde el botón de notificaciones, no al abrir la app.

Los adjuntos se identifican en el historial; esta entrega no reproduce el editor de archivos, notas de voz, reacciones ni la administración avanzada de grupos del CRM.

## Sesión y seguridad

Un único socket autenticado en `/communication/socket.io` comparte chat, llamadas, reuniones y notificaciones. El token va en `handshake.auth`, nunca en la URL. Hay deduplicación por `eventId`, renovación de sesión y recuperación al reconectar. Los recursos se consultan con el JWT y no con identificadores de propietario del teléfono.

Un cambio de cuenta cierra los transportes multimedia y limpia el estado de comunicaciones. Antes del logout se abandona la sesión y se revoca el registro push conocido. Las acciones de una notificación se limitan a rutas internas y verifican la oficina y el usuario destinatario; no abren URLs arbitrarias.

## Android: recepción con la app cerrada

**Todavía no está operativa porque no existe un proyecto Firebase configurado.** El código de registro, revocación y navegación está preparado, y el backend procesa los eventos de llamada entrante y mensaje nuevo para FCM. Un socket y una notificación local no pueden despertar de forma fiable una aplicación cerrada.

Para habilitar la entrega real:

1. Crear un proyecto Firebase y registrar una aplicación Android con paquete **`com.taxoffix.mileage`**.
2. Descargar su `google-services.json` a `android/app/google-services.json`. Esa ruta está ignorada por Git.
3. Configurar una cuenta de servicio FCM en Notification mediante un archivo secreto fuera del repositorio y la opción `Notification:Push:Fcm:ServiceAccountJsonPath`. Activar `Notification:UseFcmPush` cuando las credenciales sean válidas. En Docker se monta el secreto; no se incrusta la clave en la app.
4. Cambiar `communication.androidPushConfigured` a `true` en el entorno Android que se vaya a compilar, volver a compilar y ejecutar `npx cap sync android`.
5. Instalar la app y pulsar **Activar notificaciones de Android**. El registro usa `/notifications/push/devices`, plataforma `Fcm`, con identidad derivada del JWT.
6. Comprobar con dos cuentas autorizadas: llamada entrante, mensaje nuevo, bloqueo de pantalla, recuperación desde el aviso, expiración de una llamada y logout en un dispositivo compartido.

La notificación de llamada tiene prioridad alta y TTL corto. Al abrirla se vuelve a consultar si la llamada sigue vigente; no se acepta automáticamente. Esto prepara recepción mediante notificación, **no una integración con el marcador del sistema o una pantalla de llamada bloqueada tipo Telecom/ConnectionService**. Tampoco se garantiza una entrega si Android fuerza la detención de la aplicación.

## Conectividad para probar

- Navegador en esta PC: `npm start`, Ionic en `http://localhost:8100`, Gateway en `http://localhost:5047`.
- Emulador Android en esta PC: `npm run build:android:emulator` compila y sincroniza con Gateway en `http://10.0.2.2:5047`. Después, desde `android`, ejecutar `./gradlew.bat :app:assembleDebug --no-daemon --max-workers=2`. HTTP se permite en el manifiesto de debug. El APK actual se compiló con esta configuración.
- Un teléfono no puede usar el `localhost` de la PC. Debe tener una URL de API alcanzable, preferiblemente HTTPS.
- El entorno de producción conserva `https://api.taxoffix.io`; compilar el APK no despliega automáticamente el backend local en ese dominio.
- Para SFU detrás de Docker/NAT hay que configurar `COMMUNICATION_MEDIASOUP_ANNOUNCED_IP` con una dirección alcanzable por ambos participantes y permitir los puertos multimedia. En el contenedor local se configuró la IP LAN actual `192.168.1.137`; si cambia la red de la PC hay que actualizarla.
- Para llamadas entre redes distintas se necesita TURN operativo, configurado en el servidor. La señalización por HTTPS no sustituye la conectividad multimedia.

El Gateway local conserva su enlace a loopback. El emulador utiliza su alias especial de host; esta configuración no publica el Gateway en la LAN ni sustituye la configuración del servidor de producción.

## Verificación ejecutada

- `npm run build`: correcto; advertencia CommonJS de `mediasoup-client`, también utilizado por el CRM.
- `npm test -- --watch=false --browsers=ChromeHeadless`: **34 aprobadas**.
- ESLint sobre la fachada API, controlador de sesiones, push y página: correcto.
- `npx cap sync android`: correcto, incluido `@capacitor/push-notifications`.
- `android/gradlew.bat :app:assembleDebug --no-daemon --max-workers=2`: correcto. APK en `android/app/build/outputs/apk/debug/app-debug.apk`.
- Backend Communication: generación Prisma, typecheck y build correctos; **1.143 pruebas aprobadas** con `--maxWorkers=2`. La primera ejecución paralela agotó el tiempo de cuatro pruebas; la repetición completa pasó.
- Backend Notification: build correcto, código estático Wolverine regenerado y **668 pruebas aprobadas** excluyendo integraciones externas.

APK de debug instalado con `adb install -r` en el emulador `Pixel_9_Pro` y lanzado con `am start`; proceso activo y sin errores de cierre en los registros revisados. Communication y Notification actualizados en Docker: `/health/live` y `/health/ready` devolvieron HTTP 200 en ambos servicios. Los endpoints del Gateway requieren autenticación (HTTP 401 sin JWT). El acceso automatizado a la interfaz no estuvo disponible; no se verificó visualmente. Estas comprobaciones no equivalen a una llamada real entre dos sesiones ni a entrega real de FCM.

## Archivos

La integración está en `src/app/communication/`. Los módulos de media, negociación e ICE/SFU se adaptaron del CRM con imports locales. Se modificaron las rutas, el shell global, las entradas del dashboard/tabs, logout, entornos y permisos Android. Las dependencias nuevas son `socket.io-client`, `mediasoup-client` y `@capacitor/push-notifications`.

En el backend se añadió `GET /communication/directory/my-office`, protegido por identidad y permiso existentes, y consumidores push de los eventos existentes de llamada iniciada y mensaje enviado. No se crearon nuevas tablas ni migraciones para esta integración.

## Actualización 19 de noviembre de 2026

Chat móvil: envío de imágenes/documentos por el flujo mediado de adjuntos existente, descarga autorizada, presencia y eventos de escritura. La disponibilidad de archivos depende del análisis del servidor. Los reintentos de envío conservan la clave del adjunto mientras se mantiene la página.

Fotos de vehículos: cámara/galería, carga a CloudStorage como documento del cliente y referencia persistente `storage:<fileId>` en Photo. Requiere actualizar Mobile con la validación de referencias incluida en VehicleDetails; no cambia el esquema SQL. Las descargas se autorizan por CloudStorage y se renuevan al abrir Perfil. Una foto pendiente de análisis no se muestra hasta volver a abrir el perfil cuando esté disponible.

Firebase adjunto revisado: paquete `com.taxproffice.mobilesupport`, incompatible con `com.taxoffix.mileage`. No se ha activado androidPushConfigured ni sustituido la identidad Android. Registrar `com.taxoffix.mileage` en el mismo proyecto Firebase y descargar su google-services.json. El JSON cliente tampoco sustituye la cuenta de servicio FCM del backend.

## Firebase validado (19 de noviembre de 2026)

El archivo instalado en android/app/google-services.json ya incluye com.taxoffix.mileage dentro del proyecto taxproffice-8a46a. androidPushConfigured esta activado en los entornos. Esta comprobacion sustituye el bloqueo anterior por paquete incompatible. Falta verificar en un dispositivo el registro y la entrega de mensajes/llamadas desde produccion; el JSON cliente no confirma la cuenta de servicio FCM del backend.
