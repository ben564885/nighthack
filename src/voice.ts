import { config } from './config.js';

/**
 * outbound call for serious faults. photon only gives us the phone line (sip);
 * the voice itself comes from a voice agent. elevenlabs is the documented path
 * in photon's cookbook, so that is what this uses. not tested without keys.
 */
export async function placeCall(spokenText: string): Promise<'called' | 'skipped'> {
  const { key, agentId, phoneNumberId } = config.voice;
  const to = config.photon.userHandle;
  if (!key || !agentId || !phoneNumberId || !to) {
    console.log('[voice] skipped: set ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_PHONE_NUMBER_ID');
    return 'skipped';
  }
  const res = await fetch('https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: phoneNumberId,
      to_number: to,
      conversation_initiation_client_data: {
        conversation_config_override: { agent: { first_message: spokenText } },
      },
    }),
  });
  if (!res.ok) throw new Error(`voice call failed: ${res.status} ${await res.text()}`);
  return 'called';
}
