import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // 1. Verificar que sea una petición válida
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo se permiten peticiones POST' });
  }

  const userMessage = req.body.text; 
  const responseUrl = req.body.response_url; 

  // 2. Responder INMEDIATAMENTE a Slack (Menos de 3 segundos)
  // Esto evita que Slack corte la conexión.
  res.status(200).send("Revisando la disponibilidad en COR... ⏳");

  // 3. Procesar el resto de la tarea en segundo plano
  // Envolvemos todo el proceso pesado en una función que se ejecuta sin bloquear la respuesta inicial.
  (async () => {
    try {
      // Consultar COR
      const corResponse = await fetch('https://api.projectcor.com/v1/tasks', {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${process.env.COR_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      const corData = await corResponse.json();

      // Analizar con Gemini
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 

      const prompt = `
        Eres el coordinador de tráfico del equipo. 
        Acaba de ingresar esta nueva solicitud: "${userMessage}".
        
        Aquí tienes los datos de la carga de trabajo extraída de COR: 
        ${JSON.stringify(corData)}
        
        Analiza quién tiene el perfil adecuado y disponibilidad hoy. 
        Responde sugiriendo a la persona ideal justificando el motivo.
      `;
      
      const result = await model.generateContent(prompt);
      const iaResponse = result.response.text();

      // Enviar la respuesta final a Slack usando la response_url
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
      // Notificar a Slack si falla el proceso asíncrono
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: "Hubo un error de conexión con COR o al procesar la IA. Verifica las claves API y la estructura de los datos." 
        })
      });
    }
  })(); 
}
