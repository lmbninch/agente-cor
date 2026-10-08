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

      let allTasks = [];

      if (idsABuscar.length > 0) {
        // A. BÚSQUEDA QUIRÚRGICA (Tareas principales asignadas directamente)
        for (const id of idsABuscar) {
          const filterObj = { collaborator: id };
          const filterStr = encodeURIComponent(JSON.stringify(filterObj));
          
          const corUrl = `https://api.projectcor.com/v2/tasks?archived=2&per_page=100&filters=${filterStr}`;
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

        // B. RED DE ARRASTRE (Traemos las últimas 300 tareas activas de la agencia para escanear subtareas)
        for (let page = 1; page <= 3; page++) {
          const genUrl = `https://api.projectcor.com/v2/tasks?archived=2&per_page=100&page=${page}`;
          const genResponse = await fetch(genUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
          });
          if (genResponse.ok) {
            const genData = await genResponse.json();
            const tasksList = Array.isArray(genData) ? genData : (genData.data || genData.items || []);
            allTasks = allTasks.concat(tasksList);
            if (tasksList.length < 100) break; 
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

      // 3. LIMPIEZA, FILTRO Y ASIGNACIÓN EXACTA
      const tasksUnicas = Array.from(new Map(allTasks.map(task => [task.id, task])).values());
      const tareasLimpias = [];
      
      const now = new Date();
      const limiteFantasma = new Date();
      limiteFantasma.setDate(now.getDate() - 15);

      tasksUnicas.forEach(tarea => {
        const projectName = tarea.project?.name || 'Proyecto Gral';
        const clientName = tarea.project?.client?.name || tarea.client?.name || '';
        const contextoProyecto = clientName ? `[${clientName} > ${projectName}]` : `[${projectName}]`;

        // Evaluar Tarea Principal
        const statusName = (tarea.status && tarea.status.name) ? tarea.status.name.toLowerCase() : '';
        const currentStatus = (tarea.current_status && tarea.current_status.name) ? tarea.current_status.name.toLowerCase() : '';
        const combinedStatus = `${statusName} ${currentStatus}`;
        const isParentFinished = combinedStatus.includes('finalizad') || combinedStatus.includes('completad') || combinedStatus.includes('done') || combinedStatus.includes('aprobada') || combinedStatus.includes('entregada');

        let deadlineStr = tarea.deadline || 'Sin fecha';
        let validParentTime = true;
        if (tarea.deadline) {
          const dateDeadline = new Date(tarea.deadline);
          if (dateDeadline < limiteFantasma) validParentTime = false;
          if (dateDeadline < now) deadlineStr = `[VENCIDA] ${deadlineStr}`;
        }

        // Verificamos si la persona consultada está en la tarea principal
        const inParent = tarea.collaborators?.some(c => idsABuscar.includes(c.id)) || (tarea.pm && idsABuscar.includes(tarea.pm.id));

        if (inParent && !isParentFinished && validParentTime) {
          tareasLimpias.push({
            c: contextoProyecto,
            t: `[Tarea] ${tarea.name || tarea.title || 'Sin título'}`,
            d: deadlineStr
          });
        }

        // Evaluar Subtareas (Buscamos si la persona está explícitamente en alguna)
        if (tarea.subtasks && Array.isArray(tarea.subtasks)) {
          tarea.subtasks.forEach(sub => {
            const subStatus = (sub.status && sub.status.name) ? sub.status.name.toLowerCase() : '';
            if (subStatus.includes('finalizad') || subStatus.includes('completad') || subStatus.includes('done') || subStatus.includes('aprobada') || subStatus.includes('entregada')) return;

            let subDeadlineStr = sub.deadline || tarea.deadline || 'Sin fecha';
            let validSubTime = true;
            if (subDeadlineStr !== 'Sin fecha') {
              const sDate = new Date(subDeadlineStr);
              if (sDate < limiteFantasma) validSubTime = false;
              if (sDate < now) subDeadlineStr = `[VENCIDA] ${subDeadlineStr}`;
            }

            // Verificamos si la persona consultada está específicamente en esta subtarea
            const inSub = sub.collaborators?.some(c => idsABuscar.includes(c.id));

            if (inSub && validSubTime) {
              tareasLimpias.push({
                c: contextoProyecto,
                t: `[Subtarea] ${sub.name || sub.title || 'Sin título'}`,
                d: subDeadlineStr
              });
            }
          });
        }
      });

      // Evitamos tareas duplicadas en el array final si se repiten datos
      const tareasFinales = Array.from(new Set(tareasLimpias.map(JSON.stringify))).map(JSON.parse);

      // 4. Análisis de OpenAI con Prompt Ajustado
      const fechaHoy = new Date().toLocaleString('es-AR', { timeZone: 'America/Buenos_Aires' });

      const promptSistema = `Eres el coordinador de tráfico de la agencia Ninch. Hoy es ${fechaHoy}.
      
      REGLAS DE FORMATO CRÍTICAS:
      1. Recibes tareas con "c" = Cliente/Proyecto, "t" = Título, "d" = Deadline.
      2. Muestra cada tarea usando ESTRICTAMENTE este formato:
         - **[Cliente > Proyecto] Título de la tarea o subtarea** | Vencimiento: Fecha
      3. PROHIBIDO: Bajo ninguna circunstancia listes a los participantes.
      4. ESTRUCTURA: Agrupa en "Tareas Activas" y "Tareas Vencidas". Cierra con un resumen numérico y tu veredicto de disponibilidad.`;
      
      const promptUsuario = `Solicitud: "${text}". \n\nDatos de tareas y subtareas asignadas al usuario: ${JSON.stringify(tareasFinales)}`;

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
    text: "⏳ Extrayendo tareas principales y escaneando la red de subtareas... Esto tomará unos segundos." 
  });
}
