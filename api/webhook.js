import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });
  
  const userMessage = req.body.text; 

  try {
    // 1. COR Auth: Token temporal
    const credencialesBase64 = Buffer.from(`${process.env.COR_API_KEY}:${process.env.COR_CLIENT_SECRET}`).toString('base64');
    const tokenResponse = await fetch('https://api.projectcor.com/v1/oauth/token?grant_type=client_credentials', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credencialesBase64}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!tokenResponse.ok) throw new Error("Fallo en autenticación de COR");
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 2. COR Tasks: Obtener tareas
    const corResponse = await fetch('https://api.projectcor.com/v1/tasks', {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!corResponse.ok) throw new Error("Fallo al leer las tareas de COR");
    const corData = await corResponse.json();

    // 3. Gemini: Usando la librería oficial de Google con el modelo flash estándar
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Usamos 'gemini-1.5-flash', que es el modelo estándar soportado por la librería oficial
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      Eres el coordinador de tráfico de Distill. 
      Acaba de ingresar esta solicitud por Slack: "${userMessage}".
      
      Aquí están los datos extraídos en tiempo real de COR: 
      ${JSON.stringify(corData)}
      
      Analiza brevemente quién tiene el perfil y disponibilidad, y sugiere a la persona ideal.
    `;

    const result = await model.generateContent(prompt);
    const iaResponse = result.response.text();

    // 4. Respuesta a Slack
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
