export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  if (req.body.is_background) {
    try {
      const { text, response_url } = req.body;
      const textoLower = text.toLowerCase();

      // 1. DIRECTORIO Y MAPEOS
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

      // 2. AUTH COR
      const credencialesBase64 = Buffer.from(`${process.env.COR_API_KEY}:${process.env.COR_CLIENT_SECRET}`).toString('base64');
      const tokenResponse = await fetch('https://api.projectcor.com/v1/oauth/token?grant_type=client_credentials', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${credencialesBase64}`, 'Content-Type': 'application/json' }
      });
      if (!tokenResponse.ok) throw new Error("Fallo en autenticación de COR");
      const tokenData = await tokenResponse.json();

      let allTasks = [];

      // 3. EXTRACCIÓN POR FUERZA BRUTA (INCLUYENDO PMs)
      if (idsABuscar.length > 0) {
        const fetchPromises = [];
        const reqOpts = { method: 'GET', headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' } };

        idsABuscar.forEach(id => {
          const filterStr = encodeURIComponent(JSON.stringify({ collaborator: id }));
          
          for (let page = 1; page <= 5; page++) {
            // API v2
            fetchPromises.push(fetch(`https://api.projectcor.com/v2/tasks?per_page=100&page=${page}&sort=updated_at&direction=desc&filters=${filterStr}`, reqOpts).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })));
            
            // API v1 (Colaboradores y PMs)
            fetchPromises.push(fetch(`https://api.projectcor.com/v1/tasks?collaborator_id=${id}&per_page=100&page=${page}`, reqOpts).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })));
            fetchPromises.push(fetch(`https://api.projectcor.com/v1/tasks?collaborators=${id}&per_page=100&page=${page}`, reqOpts).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })));
            // NUEVO: Buscar explícitamente donde el usuario sea PM
            fetchPromises.push(fetch(`https://api.projectcor.com/v1/tasks?pm_id=${id}&per_page=100&page=${page}`, reqOpts).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })));
          }
        });

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

      // 4. LIMPIEZA ARTESANAL CON PM Y FOLLOWERS
      const tasksUnicas = Array.from(new Map(allTasks.map(task => [task.id, task])).values());
      const tareasLimpias = [];
      
      const now = new Date();

      // Función auxiliar para agregar usuarios sin duplicar
      const agregarAsignado = (lista, userId) => {
        if (!userId) return;
        const idNum = Number(typeof userId === 'object' ? (userId.id || userId.value) : userId);
        if (idsABuscar.includes(idNum) && !lista.includes(NOMBRES_POR_ID[idNum])) {
          lista.push(NOMBRES_POR_ID[idNum]);
        }
      };

      tasksUnicas.forEach(tarea => {
        if (tarea.archived === true || tarea.archived === 1) return;

        let statusName = (typeof tarea.status === 'string') ? tarea.status.toLowerCase() : (tarea.status?.name || '').toLowerCase();
        let currentStatus = (typeof tarea.current_status === 'string') ? tarea.current_status.toLowerCase() : (tarea.current_status?.name || '').toLowerCase();
        const combinedStatus = `${statusName} ${currentStatus}`;
        if (combinedStatus.includes('finalizad') || combinedStatus.includes('completad') || combinedStatus.includes('done') || combinedStatus.includes('aprobada') || combinedStatus.includes('entregada')) return;

        const projectName = tarea.project?.name || 'Proyecto Gral';
        const clientName = tarea.project?.client?.name || tarea.client?.name || '';
        const contextoProyecto = clientName ? `[${clientName} > ${projectName}]` : `[${projectName}]`;

        let deadlineStr = tarea.deadline || 'Sin fecha';
        if (tarea.deadline) {
          const dateDeadline = new Date(tarea.deadline);
          if (dateDeadline < now) deadlineStr = `[VENCIDA] ${deadlineStr}`;
        }

        // REINCORPORAMOS LA VERIFICACIÓN DE PM Y FOLLOWERS
        let asignadosParent = [];
        (tarea.collaborators || []).forEach(c => agregarAsignado(asignadosParent, c));
        (tarea.followers || []).forEach(f => agregarAsignado(asignadosParent, f));
        agregarAsignado(asignadosParent, tarea.pm);

        if (asignadosParent.length > 0) {
          const isSubtask = tarea.task_father || tarea.parent_id;
          tareasLimpias.push({
            u: asignadosParent.join(" y "), 
            c: contextoProyecto,
            t: `${isSubtask ? '[Subtarea]' : '[Tarea]'} ${tarea.name || tarea.title || 'Sin título'}`,
            d: deadlineStr
          });
        }

        if (tarea.subtasks && Array.isArray(tarea.subtasks)) {
          tarea.subtasks.forEach(sub => {
            if (sub.archived === true || sub.archived === 1) return;

            let subStatus = (typeof sub.status === 'string') ? sub.status.toLowerCase() : (sub.status?.name || '').toLowerCase();
            if (subStatus.includes('finalizad') || subStatus.includes('completad') || subStatus.includes('done') || subStatus.includes('aprobada') || subStatus.includes('entregada')) return;

            let subDeadlineStr = sub.deadline || tarea.deadline || 'Sin fecha';
            if (subDeadlineStr !== 'Sin fecha') {
              const sDate = new Date(subDeadlineStr);
              if (sDate < now) subDeadlineStr = `[VENCIDA] ${subDeadlineStr}`;
            }

            let asignadosSub = [];
            (sub.collaborators || []).forEach(c => agregarAsignado(asignadosSub, c));
            (sub.followers || []).forEach(f => agregarAsignado(asignadosSub, f));
            agregarAsignado(asignadosSub, sub.pm);

            if (asignadosSub.length > 0) {
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

      // 5. Análisis de OpenAI
      const fechaHoy = new Date().toLocaleString('es-AR', { timeZone: 'America/Buenos_Aires' });
      const promptSistema = `Eres el coordinador de tráfico de Ninch. Hoy es ${fechaHoy}.
      
      REGLA DE ORO: DEBES MOSTRAR EL LISTADO COMPLETO DE TAREAS.
      
      ESTRUCTURA:
      Para CADA persona (etiqueta "u"):
      1. Título con su nombre.
      2. "TAREAS ACTIVAS" (sin "[VENCIDA]") y "TAREAS VENCIDAS" (con "[VENCIDA]").
      3. Formato: **[Cliente > Proyecto] Título** | Vencimiento: Fecha
      
      CIERRE:
      - Recuento numérico.
      - "### Veredicto de Disponibilidad": Párrafo analítico.`;
      
      const promptUsuario = `Solicitud: "${text}". \n\nDatos: ${JSON.stringify(tareasFinales)}`;

      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: promptSistema }, { role: "user", content: promptUsuario }],
          temperature: 0.6 
        })
      });
      
      if (!openaiResponse.ok) throw new Error("Error en la generación de OpenAI");
      const openaiData = await openaiResponse.json();
      const iaResponse = openaiData.choices?.[0]?.message?.content || "No se pudo generar el análisis.";

      await fetch(response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_type: "in_channel", text: iaResponse })
      });

      return res.status(200).json({ success: true });
    } catch (error) {
      await fetch(req.body.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_type: "in_channel", text: `❌ Error: ${error.message}` })
      });
      return res.status(500).json({ error: error.message });
    }
  }

  // PARTE 2: MODO SLACK
  const userMessage = req.body.text;
  const responseUrl = req.body.response_url;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  
  fetch(`${protocol}://${host}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_background: true, text: userMessage, response_url: responseUrl })
  }).catch(console.error);

  await new Promise(resolve => setTimeout(resolve, 50));
  return res.status(200).json({ response_type: "in_channel", text: "⏳ Buscando en todos los roles (Colaborador, PM, Follower)... Esto tomará unos segundos." });
}
