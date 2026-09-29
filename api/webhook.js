import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // 1. Verificar que sea una petición de Slack (POST)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo se permiten peticiones POST' });
  }

  const userMessage = req.body.text; 
  const responseUrl = req.body.response_url; 

  // Slack requiere una respuesta en menos de 3 segundos, 
  // así que le enviamos este mensaje para avisar que ya estamos trabajando.
  res.status(200).send("Revisando la disponibilidad en COR... ⏳");

  try {
    // 2. Conectarse a COR y traer los datos
    // Nota: Esta URL es un ejemplo. Más adelante la cambiaremos por la URL exacta de COR.
    const corResponse = await fetch('https://api.proyectocor.com/v1/tareas', {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${process.env.COR_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const corData = await corResponse.json();

    // 3. El "Cerebro": Analizar los datos usando Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 

    const prompt = `
      Eres el coordinador de tráfico del equipo de la agencia. 
      Acaba de ingresar esta nueva solicitud: "${userMessage}".
      
      Aquí tienes la radiografía exacta y en tiempo real de la carga de trabajo 
      de la agencia extraída del sistema COR: 
      ${JSON.stringify(corData)}
      
      Analiza quién tiene el perfil adecuado y el ancho de banda disponible hoy. 
      Responde sugiriendo a la persona ideal y justificando brevemente el motivo.
    `;
    
    const result = await model.generateContent(prompt);
    const iaResponse = result.response.text();

    // 4. Enviar la decisión final de vuelta al canal de Slack
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        response_type: "in_channel",
        text: iaResponse 
      })
    });

  } catch (error) {
    console.error("Hubo un error:", error);
    // Si algo falla, le avisamos a Slack
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text: "Hubo un error al intentar leer COR o procesar la IA. Revisa la conexión." 
      })
    });
  }
}