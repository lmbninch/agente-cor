export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  // =========================================================================
  // PARTE 1: MODO SEGUNDO PLANO
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
      
      if (!tokenResponse.ok) throw new Error("Fallo en autenticación de COR");
      const tokenData = await tokenResponse.json();

      // 2. PRUEBA DE FUEGO: Fetch directo con tu ID de usuario (103480)
      const corUrl = `https://api.projectcor.com/v1/tasks?archived=2&col=103480`;
      const corResponse = await fetch(corUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
      });
      
      if (!corResponse.ok) throw new Error("Fallo al leer las tareas de COR");
      const corData = await corResponse.json();

      // 3. COMPRESIÓN DE DATOS
      const tasksList = Array.isArray(corData) ? corData : (corData.data || corData.items || []);
      const tareasLimpias = tasksList.map(tarea => {
        const cols = (tarea.collaborators || []).map(c => `${c.first_name || ''} ${c.last_name || ''}`.trim());
        const pm = tarea.pm ? `${tarea.pm.first_name || ''} ${tarea.pm.last_name || ''}`.trim() : '';
        const involucrados = [...new Set([...cols, pm].filter(Boolean))].join(', ');

        return {
          t: tarea.name || tarea.title || 'Sin título',
          d: tarea.deadline || 'Sin fecha',
          p: involucrados
        };
      });

      // 4. Análisis de OpenAI
      const fechaHoy = new Date().toLocaleString('es-AR', { timeZone: 'America/Buenos_Aires' });

      const promptSistema = `Eres el coordinador de tráfico de la agencia Ninch. Hoy es ${fechaHoy}.
      
      REGLAS DE LECTURA CRÍTICA:
      1. Tienes un listado de tareas descargadas directamente usando el ID del usuario en Project COR. "t" es el título de la tarea, "d" es el deadline, "p" son las personas asignadas.
      2. CONTEO REAL: Lee el JSON y lista todas las tareas que aparecen, ya que el sistema ya las pre-filtró por usuario.
      
      Devuelve la respuesta final en un formato limpio usando viñetas. Incluye el título de la tarea y el deadline.`;
      
      const promptUsuario = `Solicitud ingresada por Slack: "${text}". \n\nDatos de COR pre-filtrados para Leandro Barral (Total de tareas recibidas por la API: ${tareasLimpias.length}): ${JSON.stringify(tareasLimpias)}`;

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
      
      if (!openaiResponse.ok) throw new Error("Error en la generación de OpenAI");
      const openaiData = await openaiResponse.json();
      const iaResponse = openaiData.choices?.[0]?.message?.content || "No se pudo generar el análisis.";

      // 5. Enviar a Slack
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
  // PARTE 2: MODO SLACK (Respuesta instantánea)
  // =========================================================================
  const userMessage = req.body.text;
  const responseUrl = req.body.response_url;

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  const selfUrl = `${protocol}://${host}/api/webhook`;

  fetch(selfUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_background: true, text: userMessage, response_url: responseUrl })
  }).catch(console.error);

  await new Promise(resolve => setTimeout(resolve, 50));

  return res.status(200).json({ 
    response_type: "in_channel",
    text: "⏳ Buscando tareas usando tu ID directo de COR... Esto tomará unos segundos." 
  });
}
