import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // Verificamos que venga de Slack
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo se permiten peticiones POST' });
  }

  const userMessage = req.body.text; 

  try {
    // 1. Consultamos a COR inmediatamente
    const corResponse = await fetch('https://api.projectcor.com/v1/tasks', {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${process.env.COR_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const corData = await corResponse.json();

    // 2. Analizamos con Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 

    const prompt = `
      Eres el coordinador de tráfico de la agencia. 
      Acaba de ingresar esta solicitud por Slack: "${userMessage}".
      
      Aquí están los datos extraídos en tiempo real de COR: 
      ${JSON.stringify(corData)}
      
      Analiza brevemente quién tiene el perfil y disponibilidad, y sugiere a la persona ideal.
    `;
    
    const result = await model.generateContent(prompt);
    const iaResponse = result.response.text();

    // 3. Enviamos la respuesta final directamente a Slack de una sola vez
    return res.status(200).json({ 
      response_type: "in_channel",
      text: iaResponse 
    });

  } catch (error) {
    console.error("Detalle del error:", error);
    // Si algo falla, le mandamos el error a Slack
    return res.status(200).json({ 
      text: "Hubo un problema conectando con COR. Es posible que el enlace de las tareas sea diferente o la clave API haya expirado." 
    });
  }
}
