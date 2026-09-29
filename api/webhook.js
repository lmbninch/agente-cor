export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });
  
  const userMessage = req.body.text; 

  try {
    // 1. COR Auth: Pedir el token temporal a COR (Este paso ya comprobamos que funciona perfecto)
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

    // 3. Gemini: Petición HTTP directa utilizando la clave corporativa por URL (Sin dependencias externas)
    const prompt = `
      Eres el coordinador de tráfico de Distill. 
      Acaba de ingresar esta solicitud por Slack: "${userMessage}".
      
      Aquí están los datos extraídos en tiempo real de COR: 
      ${JSON.stringify(corData)}
      
      Analiza brevemente quién tiene el perfil y disponibilidad, y sugiere a la persona ideal.
    `;

    // Usamos el endpoint estándar v1 con el parámetro ?key=
    const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    
    if (!geminiResponse.ok) {
      const errorDeGoogle = await geminiResponse.text();
      throw new Error(`Error de Google Gemini: ${errorDeGoogle}`);
    }
    
    const geminiData = await geminiResponse.json();
    
    // Extraemos la respuesta generada por la IA de forma segura
    const iaResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "No se pudo procesar la respuesta de la IA.";

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
