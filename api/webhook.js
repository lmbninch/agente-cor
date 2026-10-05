export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });
  
  const userMessage = req.body.text;
  const responseUrl = req.body.response_url; // Slack envía esta URL para recibir respuestas lentas

  // 1. Respondemos INMEDIATAMENTE a Slack para evitar el operation_timeout
  res.status(200).json({ 
    response_type: "in_channel",
    text: "⏳ Analizando la carga de trabajo en COR con IA... Esto tomará unos segundos." 
  });

  try {
    // 2. COR Auth
    const credencialesBase64 = Buffer.from(`${process.env.COR_API_KEY}:${process.env.COR_CLIENT_SECRET}`).toString('base64');
    const tokenResponse = await fetch('https://api.projectcor.com/v1/oauth/token?grant_type=client_credentials', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${credencialesBase64}`, 'Content-Type': 'application/json' }
    });
    
    if (!tokenResponse.ok) throw new Error("Fallo en autenticación de COR");
    const tokenData = await tokenResponse.json();

    // 3. COR Tasks
    const corResponse = await fetch('https://api.projectcor.com/v1/tasks', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
    });
    
    if (!corResponse.ok) throw new Error("Fallo al leer las tareas de COR");
    const corData = await corResponse.json();

    // 4. OpenAI (Usamos gpt-4o-mini para mayor velocidad)
    const promptSistema = "Eres el coordinador de tráfico de Ninch. Analiza los datos de carga de trabajo de COR provistos y sugiere de forma breve y justificada a la persona ideal del equipo para asignar la solicitud.";
    const promptUsuario = `Solicitud ingresada por Slack: "${userMessage}". \n\nDatos de COR en tiempo real: ${JSON.stringify(corData)}`;

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
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
    const iaResponse = openaiData.choices?.[0]?.message?.content || "No se pudo procesar la respuesta.";

    // 5. Enviamos el análisis final a Slack de forma asíncrona
    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_type: "in_channel",
          text: iaResponse
        })
      });
    }

  } catch (error) {
    console.error("Detalle del error:", error);
    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          response_type: "in_channel",
          text: `Hubo un problema técnico procesando los datos: ${error.message}` 
        })
      });
    }
  }
}
