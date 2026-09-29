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
    
    if (!tokenResponse.ok) throw new Error("Fallo al obtener el token de COR");
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 2. COR Tasks: Pedimos las tareas
    const corResponse = await fetch('https://api.projectcor.com/v1/tasks', {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!corResponse.ok) throw new Error("Fallo al obtener las tareas de COR");
    const corData = await corResponse.json();

    // 3. Gemini: Conexión DIRECTA sin usar la librería que da error
    const prompt = `
      Eres el coordinador de tráfico de Distill. 
      Acaba de ingresar esta solicitud por Slack: "${userMessage}".
      
      Aquí están los datos extraídos en tiempo real de COR: 
      ${JSON.stringify(corData)}
      
      Analiza brevemente quién tiene el perfil y disponibilidad, y sugiere a la persona ideal.
    `;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    
    if (!geminiResponse.ok) throw new Error("Fallo en la conexión directa con Gemini");
    const geminiData = await geminiResponse.json();
    const iaResponse = geminiData.candidates[0].content.parts[0].text;

    // 4. Respondemos a Slack
    return res.status(200).json({ 
      response_type: "in_channel",
      text: iaResponse 
    });

  } catch (error) {
    console.error("Detalle del error:", error);
    return res.status(200).json({ 
      text: `Hubo un problema: ${error.message}.` 
    });
  }
}
