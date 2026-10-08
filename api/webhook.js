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
        "nasa": 103413, "lombardo": 103413, "agustina perez": 103414,
        "carolina": 103421, "dorso": 103421, "vanesa": 103434, "copes": 103434,
        "mercedes": 103436, "palumbo": 103436, "lucas": 103439, "vega": 103439,
        "candela jordi": 103441, "jordi": 103441, "joi": 103443, "sanchez": 103443,
        "demian": 103453, "buezas": 103453, "julieta": 103455, "lamarque": 103455,
        "agustina carro": 103467, "carro": 103467, "candela dallocchio": 103468, "dallocchio": 103468,
        "ignacio": 103477, "cairola": 103477, "sol": 103479, "rodriguez": 103479, "escudero": 103479,
        "leandro": 103480, "lean": 103480, "barral": 103480, "federico": 103481, "fede": 103481, "martinez": 103481,
        "matilda": 103486, "brero": 103486, "joaquin": 104457, "baez": 104457,
        "ana": 104458, "paula": 104458, "barel": 104458, "milagros": 104459, "garcia": 104459
      };

      const NOMBRES_POR_ID = {
        103413: "Nasa Lombardo", 103414: "Agustina Perez", 103421: "Carolina Dorso",
        103434: "Vanesa Copes", 103436: "Mercedes Palumbo", 103439: "Lucas Vega",
        103441: "Candela Jordi", 103443: "Joi Sanchez", 103453: "Demian Buezas",
        103455: "Julieta Lamarque", 103467: "Agustina Carro", 103468: "Candela DallOcchio",
        103477: "Ignacio Cairola", 103479: "Sol Rodriguez", 103480: "Leandro Barral",
        103481: "Federico Martinez", 103486: "Matilda Brero", 104457: "Joaquin Baez",
        104458: "Ana Paula Barel", 104459: "Milagros Garcia"
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
        const fetchPromises = [];
        const reqOpts = { method: 'GET', headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' } };

        // A. ATAQUE QUIRÚRGICO MÚLTIPLE (v2 y v1 combinados)
        idsABuscar.forEach(id => {
          const filterStr = encodeURIComponent(JSON.stringify({ collaborator: id }));
          fetchPromises.push(fetch(`https://api.projectcor.com/v2/tasks?archived=2&per_page=100&filters=${filterStr}`, reqOpts).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })));
          // Respaldo v1
          fetchPromises.push(fetch(`https://api.projectcor.com/v1/tasks?collaborator_id=${id}&per_page=100`, reqOpts).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })));
        });

        // B. RED DE ARRASTRE ORDENADA POR ACTUALIZACIÓN RECIENTE
        for (let page = 1; page <= 6; page++) {
          fetchPromises.push(fetch(`https://api.projectcor.com/v2/tasks?archived=2&per_page=100&page=${page}`, reqOpts).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })));
          fetchPromises.push(fetch(`https://api.projectcor.com/v2/tasks?archived=2&per_page=100&page=${page}&sort=updated_at&direction=desc`, reqOpts).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })));
        }

        const pagesResults = await Promise.all(fetchPromises);
        pagesResults.forEach(data => {
          const tasksList = Array.isArray(data) ? data : (data.data || data.items || []);
          allTasks = allTasks.concat(tasksList);
        });

      } else {
        await fetch(response_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response_type: "in_channel", text: "⚠️ Por favor, menciona al menos a un integrante del equipo creativo." })
        });
        return res.status(200).json({ success: true });
      }

      // 3. LIMPIEZA, DETECCIÓN TEXTUAL Y CLASIFICACIÓN
      const tasksUnicas = Array.from(new Map(allTasks.map(task => [task.id, task])).values());
      const tareasLimpias = [];
      
      const now = new Date();
      const limiteFantasma = new Date();
      limiteFantasma.setDate(now.getDate() - 15);

      tasksUnicas.forEach(tarea => {
        const projectName = tarea.project?.name || 'Proyecto Gral';
        const clientName = tarea.project?.client?.name || tarea.client?.name || '';
        const contextoProyecto = clientName ? `[${clientName} > ${projectName}]` : `[${projectName}]`;

        // Lector adaptativo de estados (String u Objeto)
        let statusName = '';
        if (typeof tarea.status === 'string') statusName = tarea.status.toLowerCase();
        else if (tarea.status && tarea.status.name) statusName = tarea.status.name.toLowerCase();
        
        let currentStatus = '';
        if (typeof tarea.current_status === 'string') currentStatus = tarea.current_status.toLowerCase();
        else if (tarea.current_status && tarea.current_status.name) currentStatus = tarea.current_status.name.toLowerCase();

        const combinedStatus = `${statusName} ${currentStatus}`;
        const isParentFinished = combinedStatus.includes('finalizad') || combinedStatus.includes('completad') || combinedStatus.includes('done') || combinedStatus.includes('aprobada') || combinedStatus.includes('entregada');

        let deadlineStr = tarea.deadline || 'Sin fecha';
        let validParentTime = true;
        if (tarea.deadline) {
          const dateDeadline = new Date(tarea.deadline);
          if (dateDeadline < limiteFantasma) validParentTime = false;
          if (dateDeadline < now) deadlineStr = `[VENCIDA] ${deadlineStr}`;
        }

        let asignadosParent = [];
        (tarea.collaborators || []).forEach(c => {
          const colabId = c.id || c;
          if (idsABuscar.includes(colabId)) asignadosParent.push(NOMBRES_POR_ID[colabId] || "Colaborador");
        });
        if (tarea.pm) {
          const pmId = tarea.pm.id || tarea.pm;
          if (idsABuscar.includes(pmId) && !asignadosParent.includes(NOMBRES_POR_ID[pmId])) {
            asignadosParent.push(NOMBRES_POR_ID[pmId] || "PM");
          }
        }

        if (asignadosParent.length > 0 && !isParentFinished && validParentTime) {
          // Detecta si la tarea general obtenida es en realidad una subtarea devuelta por la v1
          const isActuallySubtask = tarea.task_father || tarea.parent_id;
          const taskTypeLabel = isActuallySubtask ? '[Subtarea]' : '[Tarea]';
          tareasLimpias.push({
            u: asignadosParent.join(" y "), 
            c: contextoProyecto,
            t: `${taskTypeLabel} ${tarea.name || tarea.title || 'Sin título'}`,
            d: deadlineStr
          });
        }

        // Subtareas anidadas
        if (tarea.subtasks && Array.isArray(tarea.subtasks)) {
          tarea.subtasks.forEach(sub => {
            let subStatusName = '';
            if (typeof sub.status === 'string') subStatusName = sub.status.toLowerCase();
            else if (sub.status && sub.status.name) subStatusName = sub.status.name.toLowerCase();

            if (subStatusName.includes('finalizad') || subStatusName.includes('completad') || subStatusName.includes('done') || subStatusName.includes('aprobada') || subStatusName.includes('entregada')) return;

            let subDeadlineStr = sub.deadline || tarea.deadline || 'Sin fecha';
            let validSubTime = true;
            if (subDeadlineStr !== 'Sin fecha') {
              const sDate = new Date(subDeadlineStr);
              if (sDate < limiteFantasma) validSubTime = false;
              if (sDate < now) subDeadlineStr = `[VENCIDA] ${subDeadlineStr}`;
            }

            let asignadosSub = [];
            (sub.collaborators || []).forEach(c => {
              const colabId = c.id || c;
              if (idsABuscar.includes(colabId)) asignadosSub.push(NOMBRES_POR_ID[colabId] || "Colaborador");
            });

            if (asignadosSub.length > 0 && validSubTime) {
              tareasLimpias.push({
                u: asignadosSub.join(" y "),
                c: contextoProyecto,
                t: `[Subtarea] ${sub.name || sub.title || 'Sin título'}`,
                d: subDeadlineStr
              });
            }
          });
        }
      });

      const tareasFinales = Array.from(new Set(tareasLimpias.map(JSON.stringify))).map(JSON.parse);

      // 4. Análisis de OpenAI CON REGLAS BLINDADAS
      const fechaHoy = new Date().toLocaleString('es-AR', { timeZone: 'America/Buenos_Aires' });

      const promptSistema = `Eres el coordinador de tráfico de la agencia Ninch. Hoy es ${fechaHoy}.
      
      REGLA DE ORO INQUEBRANTABLE:
      Sin importar cómo formule la pregunta el usuario (incluso si solo dice "cuántas" o "quién"), ESTÁS OBLIGADO A MOSTRAR EL LISTADO COMPLETO de tareas. NUNCA respondas con un simple resumen de una oración.
      
      ESTRUCTURA QUE DEBES CUMPLIR OBLIGATORIAMENTE:
      Para CADA persona mencionada en los datos (fíjate en la etiqueta "u" de cada tarea):
      1. Pon el nombre de la persona como título principal.
      2. Subdivide sus tareas en "TAREAS ACTIVAS" (fecha "d" NO contiene "[VENCIDA]") y "TAREAS VENCIDAS" (fecha "d" CONTIENE "[VENCIDA]").
      
      REGLAS DE FORMATO POR TAREA:
      - Usa este formato exacto: **[Cliente > Proyecto] Título** | Vencimiento: Fecha
      - PROHIBIDO inventar tareas o listar a los participantes en las viñetas.
      
      CIERRE:
      - Recuento numérico general.
      - "### Veredicto de Disponibilidad": Escribe un párrafo completo y analítico comparando la carga de trabajo de los involucrados para justificar quién está más libre para un nuevo proyecto.`;
      
      const promptUsuario = `Solicitud original: "${text}". \n\nDatos reales (TIENES QUE MOSTRAR EL LISTADO OBLIGATORIAMENTE AGRUPADO POR LA ETIQUETA "u"): ${JSON.stringify(tareasFinales)}`;

      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: promptSistema },
            { role: "user", content: promptUsuario }
          ],
          temperature: 0.6 
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
    text: "⏳ Buscando tareas asignadas... Esto tomará unos segundos." 
  });
}
