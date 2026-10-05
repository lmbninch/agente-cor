export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  // =========================================================================
  // PARTE 1: MODO SEGUNDO PLANO
  // =========================================================================
  if (req.body.is_background) {
    try {
      const { text, response_url } = req.body;
      const textoLower = text.toLowerCase();

      // 1. COR Auth
      const credencialesBase64 = Buffer.from(`${process.env.COR_API_KEY}:${process.env.COR_CLIENT_SECRET}`).toString('base64');
      const tokenResponse = await fetch('https://api.projectcor.com/v1/oauth/token?grant_type=client_credentials', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${credencialesBase64}`, 'Content-Type': 'application/json' }
      });
      
      if (!tokenResponse.ok) throw new Error("Fallo en autenticación de COR");
      const tokenData = await tokenResponse.json();

      // 2. DIRECTORIO DINÁMICO: Obtenemos todos los usuarios para mapear sus IDs reales
      const usersResponse = await fetch('https://api.projectcor.com/v2/users', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
      });

      let colaboradoresEncontrados = [];
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        const usersList = Array.isArray(usersData) ? usersData : (usersData.data || usersData.items || []);
        
        // Buscamos a qué usuarios nombró el usuario en el texto de Slack de forma flexible
        colaboradoresEncontrados = usersList.filter(user => {
          const firstName = (user.first_name || '').toLowerCase();
          const lastName = (user.last_name || '').toLowerCase();
          
          // Comparamos si el nombre o apellido suelto está presente en la consulta
          return (firstName && textoLower.includes(firstName)) || 
                 (lastName && textoLower.includes(lastName));
        });
      }

      let allTasks = [];

      // 3. EXTRACCIÓN QUIRÚRGICA DIRECTA POR ID
      if (colaboradoresEncontrados.length > 0) {
        for (const colaborador of colaboradoresEncontrados) {
          // Usamos el formato JSON exacto de la API v2 que descubrimos en Network
          const filterObj = { collaborator: colaborador.id };
          const filterStr = encodeURIComponent(JSON.stringify(filterObj));
          
          const corUrl = `https://api.projectcor.com/v2/tasks?archived=2&filters=${filterStr}`;
          const corResponse = await fetch(corUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
          });
          
          if (corResponse.ok) {
            const corData = await corResponse.json();
            const tasksList = Array.isArray(corData) ? corData : (corData.data || corData.items || []);
            allTasks = allTasks.concat(tasksList);
          }
        }
      } 

      // Si no detectó nombres específicos en el directorio, traemos un bloque amplio reciente
      if (allTasks.length === 0 && colaboradoresEncontrados.length === 0) {
        const corUrl = `https://api.projectcor.com/v2/tasks?archived=2&per_page=100&page=1`;
        const corResponse = await fetch(corUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
        });
        if (corResponse.ok) {
          const corData = await corResponse.json();
          allTasks = Array.isArray(corData) ? corData : (corData.data || corData.items || []);
        }
      }

      // 4. COMPRESIÓN DE DATOS
      const tasksUnicas = Array.from(new Map(allTasks.map(task => [task.id, task])).values());

      const tareasLimpias = tasksUnicas.map(tarea => {
        const cols = (tarea.collaborators || []).map(c => `${c.first_name || ''} ${c.last_name || ''}`.trim());
        const pm = tarea.pm ? `${tarea.pm.first_name || ''} ${tarea.pm.last_name || ''}`.trim() : '';
        const involucrados = [...new Set([...cols, pm].filter(Boolean))].join(', ');

        return {
          t: tarea.name || tarea.title || 'Sin título',
          d: tarea.deadline || 'Sin fecha',
          p: involucrados
        };
      });

      // 5. Análisis de OpenAI
      const fechaHoy = new Date().toLocaleString('es-AR', { timeZone: 'America/Buenos_Aires' });

      const promptSistema = `Eres el coordinador de tráfico experto de la agencia Ninch. Hoy es ${fechaHoy}.
      
      REGLAS DE ANÁLISIS:
      1. Recibes un listado de tareas ("t" = título, "d" = deadline, "p" = personas asignadas).
      2. BÚSQUEDA EXHAUSTIVA: Analiza las tareas recibidas y busca los nombres de las personas consultadas en la propiedad "p".
      3. CRITERIO DE DISPONIBILIDAD: Cruza el volumen de tareas con la cercanía de los deadlines para decidir quién está más libre o saturado.
      4. FORMATO: Presenta un reporte profesional en viñetas con el título de la tarea y su deadline, cerrando con un veredicto de quién está más libre para tomar nuevos proyectos.`;
      
      const promptUsuario = `Solicitud en Slack: "${text}". \n\nDatos de COR procesados: ${JSON.stringify(tareasLimpias)}`;

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

      // 6. Enviar a Slack
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
  // PARTE 2: MODO SLACK (Respuesta instantánea)
  // =========================================================================
  const userMessage = req.body.text;
  const responseUrl = req.body.response_url;

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  const selfUrl = `${protocol}://${host}/api/webhook`;

  fetch(selfUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_background: true, text: userMessage, response_url: responseUrl })
  }).catch(console.error);

  await new Promise(resolve => setTimeout(resolve, 50));

  return res.status(200).json({ 
    response_type: "in_channel",
    text: "⏳ Consultando IDs y evaluando disponibilidad en COR... Esto tomará unos segundos." 
  });
}
