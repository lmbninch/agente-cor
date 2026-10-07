export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  // =========================================================================
  // PARTE 1: MODO SEGUNDO PLANO
  // =========================================================================
  if (req.body.is_background) {
    try {
      const { text, response_url } = req.body;
      const textoLower = text.toLowerCase();

      // 1. DIRECTORIO OFICIAL DEL EQUIPO CREATIVO
      const DIRECTORIO_CREATIVO = {
        "nasa": 103413, "lombardo": 103413,
        "agustina perez": 103414,
        "carolina": 103421, "dorso": 103421,
        "vanesa": 103434, "copes": 103434,
        "mercedes": 103436, "palumbo": 103436,
        "lucas": 103439, "vega": 103439,
        "candela jordi": 103441, "jordi": 103441,
        "joi": 103443, "sanchez": 103443,
        "demian": 103453, "buezas": 103453,
        "julieta": 103455, "lamarque": 103455,
        "agustina carro": 103467, "carro": 103467,
        "candela dallocchio": 103468, "dallocchio": 103468,
        "ignacio": 103477, "cairola": 103477,
        "sol": 103479, "rodriguez": 103479, "escudero": 103479,
        "leandro": 103480, "lean": 103480, "barral": 103480,
        "federico": 103481, "fede": 103481, "martinez": 103481,
        "matilda": 103486, "brero": 103486,
        "joaquin": 104457, "baez": 104457,
        "ana": 104458, "paula": 104458, "barel": 104458,
        "milagros": 104459, "garcia": 104459
      };

      let idsABuscar = [];
      for (const [clave, id] of Object.entries(DIRECTORIO_CREATIVO)) {
        if (textoLower.includes(clave) && !idsABuscar.includes(id)) {
          idsABuscar.push(id);
        }
      }

      // 2. COR Auth
      const credencialesBase64 = Buffer.from(`${process.env.COR_API_KEY}:${process.env.COR_CLIENT_SECRET}`).toString('base64');
      const tokenResponse = await fetch('https://api.projectcor.com/v1/oauth/token?grant_type=client_credentials', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${credencialesBase64}`, 'Content-Type': 'application/json' }
      });
      
      if (!tokenResponse.ok) throw new Error("Fallo en autenticación de COR");
      const tokenData = await tokenResponse.json();

      // 3. EXTRACCIÓN QUIRÚRGICA POR ID
      let allTasks = [];

      if (idsABuscar.length > 0) {
        for (const id of idsABuscar) {
          const filterObj = { collaborator: id };
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
      } else {
        await fetch(response_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response_type: "in_channel", text: "⚠️ Por favor, menciona al menos a un integrante del equipo creativo." })
        });
        return res.status(200).json({ success: true });
      }

      // 4. LIMPIEZA Y COMPRESIÓN (Filtro de estados y extracción de subtareas)
      const tasksUnicas = Array.from(new Map(allTasks.map(task => [task.id, task])).values());
      const tareasLimpias = [];

      tasksUnicas.forEach(tarea => {
        // FILTRO DE TAREAS FINALIZADAS
        const statusName = (tarea.status && tarea.status.name) ? tarea.status.name.toLowerCase() : '';
        const currentStatus = (tarea.current_status && tarea.current_status.name) ? tarea.current_status.name.toLowerCase() : '';
        const combinedStatus = `${statusName} ${currentStatus}`;
        
        // Si el estado contiene palabras de cierre, saltamos esta tarea y no la sumamos a la lista
        if (combinedStatus.includes('finalizad') || combinedStatus.includes('completad') || combinedStatus.includes('done')) {
          return; 
        }

        const cols = (tarea.collaborators || []).map(c => `${c.first_name || ''} ${c.last_name || ''}`.trim());
        const pm = tarea.pm ? `${tarea.pm.first_name || ''} ${tarea.pm.last_name || ''}`.trim() : '';
        const involucrados = [...new Set([...cols, pm].filter(Boolean))].join(', ');

        tareasLimpias.push({
          t: tarea.name || tarea.title || 'Sin título',
          d: tarea.deadline || 'Sin fecha',
          p: involucrados
        });

        // EXTRACCIÓN DE SUBTAREAS (Si COR las envía anidadas)
        if (tarea.subtasks && Array.isArray(tarea.subtasks)) {
          tarea.subtasks.forEach(sub => {
            const subStatus = (sub.status && sub.status.name) ? sub.status.name.toLowerCase() : '';
            if (subStatus.includes('finalizad') || subStatus.includes('completad') || subStatus.includes('done')) return;

            const subCols = (sub.collaborators || []).map(c => `${c.first_name || ''} ${c.last_name || ''}`.trim());
            const subInvolucrados = [...new Set([...subCols].filter(Boolean))].join(', ');
            
            if (subInvolucrados) {
              tareasLimpias.push({
                t: `[Subtarea] ${sub.name || sub.title || 'Sin título'} (de: ${tarea.name || tarea.title})`,
                d: sub.deadline || tarea.deadline || 'Sin fecha',
                p: subInvolucrados
              });
            }
          });
        }
      });

      // 5. Análisis de OpenAI
      const fechaHoy = new Date().toLocaleString('es-AR', { timeZone: 'America/Buenos_Aires' });

      const promptSistema = `Eres el coordinador de tráfico experto de la agencia Ninch. Hoy es ${fechaHoy}.
      
      REGLAS DE ANÁLISIS:
      1. Recibes un listado limpio de tareas activas reales ("t" = título, "d" = deadline, "p" = personas asignadas). Las tareas finalizadas ya fueron removidas.
      2. CRITERIO DE DISPONIBILIDAD: Contrasta el volumen de tareas activas de cada persona con la cercanía de los deadlines. Identifica claramente si son tareas principales o [Subtareas].
      3. FORMATO: Presenta un reporte ejecutivo en viñetas detallando las tareas y deadlines de cada persona mencionada. Cierra con un veredicto justificado sobre quién está más libre para tomar un nuevo proyecto.`;
      
      const promptUsuario = `Solicitud en Slack: "${text}". \n\nDatos reales extraídos de COR: ${JSON.stringify(tareasLimpias)}`;

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
    text: "⏳ Limpiando tareas finalizadas y buscando subtareas en COR... Esto tomará unos segundos." 
  });
}
