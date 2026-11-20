/**
 * Qué cede el encoder cuando falta ancho de banda al compartir pantalla. Con texto (contentHint
 * 'detail') se protege la resolución; con video ('motion'), la fluidez. Se fija explícito porque
 * Safari prioriza fps por defecto y la preferencia explícita manda sobre el contentHint.
 */
export function screenDegradationPreference(
  track: MediaStreamTrack | null | undefined
): RTCDegradationPreference {
  return track?.contentHint === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
}

/** Aplica la preferencia al sender; si el navegador no la acepta, sigue con la suya. */
export async function applyDegradationPreference(
  sender: RTCRtpSender | null | undefined,
  preference: RTCDegradationPreference
): Promise<void> {
  if (!sender) {
    return;
  }
  try {
    const params = sender.getParameters() as RTCRtpSendParameters & {
      degradationPreference?: RTCDegradationPreference;
    };
    if (params.degradationPreference === preference) {
      return;
    }
    params.degradationPreference = preference;
    await sender.setParameters(params);
  } catch {
    // Sin soporte (o antes de negociar): el navegador conserva su comportamiento.
  }
}
