import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });
  const userMessage = req.body.text; 

  try {
    // 1. Ir a la "garita": Pedir el token temporal a COR usando Basic Auth
    // COR requiere que la API Key y el Secret se unan y se codifiquen en Base64
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

    // 2. Con el pase temporal en mano, pedimos las tareas
    const corResponse = await fetch('https://api.projectcor.com/v1/tasks', {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${accessToken}`, // Aquí usamos el pase temporal
        'Content-Type': 'application/json'
      }
    });
    
    if (!corResponse.ok) throw new Error("Fallo al obtener las tareas");
    const corData = await corResponse.json();

    // 3. Analizamos con Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 
    const prompt = `
      Eres el coordinador de tráfico de Distill. 
      Acaba de ingresar esta solicitud por Slack: "${userMessage}".
      
      Aquí están los datos extraídos en tiempo real de COR: 
      ${JSON.stringify(corData)}
      
      Analiza brevemente quién tiene el perfil y disponibilidad, y sugiere a la persona ideal.
    `;
    const result = await model.generateContent(prompt);
    
    // 4. Respondemos a Slack
    return res.status(200).json({ 
      response_type: "in_channel",
      text: result.response.text() 
    });

  } catch (error) {
    console.error("Detalle del error:", error);
    return res.status(200).json({ 
      text: `Hubo un problema: ${error.message}.` 
    });
  }
}
