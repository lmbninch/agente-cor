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
      
      if (!tokenResponse.ok) throw new Error("Fallo en autenticación de COR");
      const tokenData = await tokenResponse.json();

      // 2. COR Tasks
      const corResponse = await fetch('https://api.projectcor.com/v1/tasks', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
      });
      
      if (!corResponse.ok) throw new Error("Fallo al leer las tareas de COR");
      const corData = await corResponse.json();

      // 3. Análisis de OpenAI con Prompt optimizado para escenarios múltiples
      // Calculamos la fecha actual en Argentina para que entienda cuándo es "hoy"
      const fechaHoy = new Date().toLocaleString('es-AR', { timeZone: 'America/Buenos_Aires' });

      const promptSistema = `Eres el coordinador de tráfico experto de la agencia Ninch. Tienes acceso a los datos de Project COR. Hoy es ${fechaHoy}.
      
      Tus REGLAS CRÍTICAS de análisis son:
      1. COMPRENSIÓN DIRECTA: Si el usuario pide un listado o resumen, entrégalo en viñetas sin sugerir asignaciones. Si pide a quién asignar una tarea, analiza y da un solo nombre justificado.
      2. EQUIPO CREATIVO: Identifica a este equipo filtrando usuarios cuyos roles o títulos contengan palabras como "Creativo", "Director", "Arte", "Redactor", "Copy", "Diseñador", "Design", o "Audiovisual". Excluye estrictamente a RRHH (People & Organization), Finanzas, y directivos C-Level.
      3. FILTRO DE ARGENTINA: Si el usuario pide datos de "Argentina", busca en los clientes o usuarios campos, etiquetas o locaciones que coincidan con "AR", "Argentina" o "Buenos Aires".
      4. FECHAS Y DEADLINES: Usa la fecha actual provista para cruzar con los deadlines de las tareas. Solo muestra lo que corresponde estrictamente al marco temporal solicitado.
      5. CRITERIO DE ASIGNACIÓN: Cuando debas sugerir a alguien, cruza el filtro de rol + ubicación + disponibilidad (quien tenga más horas libres o menos tareas activas). No asignes tareas operativas a roles de management de RRHH.
      
      Mantén el formato limpio, profesional y fácil de leer en Slack.`;
      
      const promptUsuario = `Solicitud ingresada por Slack: "${text}". \n\nDatos de COR extraídos en tiempo real: ${JSON.stringify(corData)}`;

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
    text: "⏳ Analizando la carga de trabajo y fechas en COR... Esto tomará unos segundos." 
  });
}
