export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });
  
  const userMessage = req.body.text; 

  try {
    // 1. COR Auth: Pedir el token temporal a COR
    const credencialesBase64 = Buffer.from(`${process.env.COR_API_KEY}:${process.env.COR_CLIENT_SECRET}`).toString('base64');
    const tokenResponse = await fetch('https://api.projectcor.com/v1/oauth/token?grant_type=client_credentials', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credencialesBase64}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!tokenResponse.ok) {
      const errorCorAuth = await tokenResponse.text();
      throw new Error(`Fallo en autenticación de COR: ${errorCorAuth}`);
    }
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 2. COR Tasks: Obtener las tareas del equipo
    const corResponse = await fetch('https://api.projectcor.com/v1/tasks', {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!corResponse.ok) {
      const errorCorTasks = await corResponse.text();
      throw new Error(`Fallo al leer las tareas de COR: ${errorCorTasks}`);
    }
    const corData = await corResponse.json();

    // 3. ChatGPT (OpenAI): Conexión directa y estable por HTTP POST
    const promptSistema = "Eres el coordinador de tráfico de Ninch. Analiza los datos de carga de trabajo de COR provistos y sugiere de forma breve y justificada a la persona ideal del equipo para asignar la solicitud.";
    const promptUsuario = `Solicitud ingresada por Slack: "${userMessage}". \n\nDatos de COR en tiempo real: ${JSON.stringify(corData)}`;

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "gpt-4o", // O puedes usar "gpt-4o-mini"
        messages: [
          { role: "system", content: promptSistema },
          { role: "user", content: promptUsuario }
        ],
        temperature: 0.7
      })
    });
    
    if (!openaiResponse.ok) {
      const errorDeOpenAI = await openaiResponse.text();
      throw new Error(`Error de OpenAI: ${errorDeOpenAI}`);
    }
    
    const openaiData = await openaiResponse.json();
    const iaResponse = openaiData.choices?.[0]?.message?.content || "No se pudo procesar la respuesta.";

    // 4. Respondemos a Slack con el análisis final
    return res.status(200).json({ 
      response_type: "in_channel",
      text: iaResponse 
    });

  } catch (error) {
    console.error("Detalle del error:", error);
    return res.status(200).json({ 
      text: `Hubo un problema técnico: ${error.message}` 
    });
  }
}
