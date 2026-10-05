export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  // =========================================================================
  // PARTE 1: MODO SEGUNDO PLANO (El webhook se llama a sí mismo para pensar)
  // =========================================================================
  if (req.body.is_background) {
    try {
      const { text, response_url } = req.body;

      // 1. COR Auth
      const credencialesBase64 = Buffer.from(`${process.env.COR_API_KEY}:${process.env.COR_CLIENT_SECRET}`).toString('base64');
      const tokenResponse = await fetch('https://api.projectcor.com/v1/oauth/token?grant_type=client_credentials', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${credencialesBase64}`, 'Content-Type': 'application/json' }
      });
      const tokenData = await tokenResponse.json();

      // 2. COR Tasks
      const corResponse = await fetch('https://api.projectcor.com/v1/tasks', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
      });
      const corData = await corResponse.json();

      // 3. Análisis de OpenAI
      const promptSistema = "Eres el coordinador de tráfico de Ninch. Analiza los datos de carga de trabajo de COR provistos y sugiere de forma breve y justificada a la persona ideal del equipo para asignar la solicitud.";
      const promptUsuario = `Solicitud ingresada por Slack: "${text}". \n\nDatos de COR: ${JSON.stringify(corData)}`;

      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: promptSistema },
            { role: "user", content: promptUsuario }
          ],
          temperature: 0.7
        })
      });
      const openaiData = await openaiResponse.json();
      const iaResponse = openaiData.choices?.[0]?.message?.content || "No se pudo generar el análisis.";

      // 4. Enviar respuesta final a Slack
      await fetch(response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_type: "in_channel", text: iaResponse })
      });

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error en background:", error);
      await fetch(req.body.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_type: "in_channel", text: `❌ Error procesando los datos: ${error.message}` })
      });
      return res.status(500).json({ error: error.message });
    }
  }

  // =========================================================================
  // PARTE 2: MODO SLACK (Respuesta instantánea para evitar el timeout)
  // =========================================================================
  const userMessage = req.body.text;
  const responseUrl = req.body.response_url;

  // Obtenemos la URL de nuestro propio webhook en Vercel
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  const selfUrl = `${protocol}://${host}/api/webhook`;

  // Nos auto-llamamos en segundo plano pasándole los datos
  fetch(selfUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      is_background: true,
      text: userMessage,
      response_url: responseUrl
    })
  }).catch(console.error);

  // Le damos 50 milisegundos para asegurar que el request de fondo salga de Vercel
  await new Promise(resolve => setTimeout(resolve, 50));

  // Respondemos inmediatamente a Slack para que no corte la conexión
  return res.status(200).json({ 
    response_type: "in_channel",
    text: "⏳ Analizando la carga de trabajo en COR con IA... Esto tomará unos segundos." 
  });
}
