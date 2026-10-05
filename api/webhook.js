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

      // 2. Cálculo dinámico de fechas (Hoy hasta Hoy + 15 días en formato YYYY-MM-DD)
      const now = new Date();
      const formatDate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      };
      
      const startDate = formatDate(now);
      const futureDate = new Date(now);
      futureDate.setDate(now.getDate() + 15);
      const endDate = formatDate(futureDate);

      // 3. COR Tasks: Filtramos por Activas (archived=2), Creativos ARG (team=31010) y rango de 15 días
      const corUrl = `https://api.projectcor.com/v1/tasks?archived=2&team=31010&start=${startDate}&end=${endDate}`;
      const corResponse = await fetch(corUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
      });
      
      if (!corResponse.ok) throw new Error("Fallo al leer las tareas de COR");
      const corData = await corResponse.json();

      // 4. Análisis de OpenAI con Prompt optimizado
      const fechaHoy = now.toLocaleString('es-AR', { timeZone: 'America/Buenos_Aires' });

      const promptSistema = `Eres el coordinador de tráfico de la agencia Ninch. Analizas datos de Project COR pre-filtrados (solo tareas activas del equipo Creativos ARG para los próximos 15 días). Hoy es ${fechaHoy}.
      
      REGLAS DE LECTURA CRÍTICA:
      1. COLABORADORES: El campo clave de asignación es el array "collaborators". Adentro, los nombres están divididos. Debes unir lógicamente "first_name" y "last_name" para identificar a la persona (ej. Leandro Barral).
      2. BÚSQUEDA EXHAUSTIVA: No busques coincidencias simples. Entra al campo "collaborators" de cada tarea, une el nombre y apellido, y verifica si coincide con la persona que consultó el usuario. 
      3. CONTEO REAL: Si el usuario pide saber cuántas tareas tiene alguien, cuenta y enlista cada tarea donde esa persona aparezca.
      4. LIMITACIÓN DE DATOS: Ten en cuenta que tus datos actuales solo reflejan las tareas activas del equipo Creativos ARG con vencimiento en los próximos 15 días. Si alguien tiene 0 tareas, aclara que es "bajo estos filtros".
      
      CRITERIOS DE SATURACIÓN Y ASIGNACIÓN:
      1. Volumen vs. Urgencia: Cruza la cantidad total de tareas activas de cada persona con la proximidad de sus deadlines. Alguien con múltiples tareas para la próxima semana tiene mayor disponibilidad real que alguien con pocas tareas que vencen hoy.
      2. Filtro de Roles: Excluye permanentemente a RRHH (People & Organization), Finanzas y C-Level para tareas operativas, sin importar su disponibilidad aparente.
      
      Formato: Si se solicita un listado, devuélvelo en viñetas incluyendo el nombre de la tarea/proyecto y el deadline específico.`;
      
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

      // 5. Enviar respuesta final a Slack
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
    text: "⏳ Analizando la carga de trabajo del equipo creativo en COR... Esto tomará unos segundos." 
  });
}
