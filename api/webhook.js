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

      // 2. DIRECTORIO DINÁMICO INTELIGENTE: Obtenemos todos los usuarios
      const usersResponse = await fetch('https://api.projectcor.com/v2/users', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
      });

      let colaboradoresEncontrados = [];
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        const usersList = Array.isArray(usersData) ? usersData : (usersData.data || usersData.items || []);
        
        // Búsqueda flexible: tokeniza el texto del usuario de Slack y busca coincidencias parciales
        colaboradoresEncontrados = usersList.filter(user => {
          const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
          const firstName = (user.first_name || '').toLowerCase();
          const lastName = (user.last_name || '').toLowerCase();
          
          // Verificamos si alguna parte del nombre o apellido está en el mensaje de Slack
          const palabras = textoLower.split(/\s+/);
          return palabras.some(palabra => 
            palabra.length > 2 && (firstName.includes(palabra) || lastName.includes(palabra) || fullName.includes(palabra))
          );
        });
      }

      let allTasks = [];

      if (colaboradoresEncontrados.length > 0) {
        // EXTRACCIÓN QUIRÚRGICA POR ID para cada colaborador detectado
        for (const colaborador of colaboradoresEncontrados) {
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

      // Si por alguna razón el directorio dinámico no encontró IDs exactos,
      // Hacemos un barrido masivo seguro por páginas (hasta 500 tareas) para no quedar atrapados en las primeras 20.
      if (allTasks.length === 0) {
        let page = 1;
        while (page <= 5) {
          const corUrl = `https://api.projectcor.com/v2/tasks?archived=2&per_page=100&page=${page}`;
          const corResponse = await fetch(corUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
          });
          
          if (!corResponse.ok) break;
          const corData = await corResponse.json();
          const tasksList = Array.isArray(corData) ? corData : (corData.data || corData.items || []);
          
          if (tasksList.length === 0) break;
          allTasks = allTasks.concat(tasksList);
          page++;
        }
      }

      // 3. COMPRESIÓN DE DATOS (Eliminamos duplicados si un usuario apareció por múltiples vías)
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

      // 4. Análisis de OpenAI con Criterio de Tráfico Avanzado
      const fechaHoy = new Date().toLocaleString('es-AR', { timeZone: 'America/Buenos_Aires' });

      const promptSistema = `Eres el coordinador de tráfico experto de la agencia Ninch. Hoy es ${fechaHoy}.
      
      REGLAS DE ANÁLISIS Y DISPONIBILIDAD:
      1. ANALISIS DE CARGA: Recibes un listado de tareas activas ("t" = título, "d" = deadline, "p" = personas asignadas).
      2. BUSQUEDA EXHAUSTIVA: Identifica a las personas nombradas por el usuario en la solicitud y busca sus nombres en la propiedad "p" de cada tarea.
      3. CRITERIO DE SATURACIÓN: Cruza el volumen de tareas de cada persona con la proximidad de los deadlines para determinar quién está más libre o saturado.
      4. FORMATO: Presenta la información de forma ejecutiva, ordenada en viñetas con el título de la tarea y su deadline correspondiente, cerrando con una conclusión clara de disponibilidad o recomendación de asignación.`;
      
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

      // 5. Enviar a Slack
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
    text: "⏳ Analizando cargas de trabajo, deadlines y disponibilidad... Esto tomará unos segundos." 
  });
}
