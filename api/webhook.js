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

      if (idsABuscar.length === 0) {
        await fetch(response_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response_type: "in_channel", text: "⚠️ Por favor, menciona al menos a un integrante del equipo creativo." })
        });
        return res.status(200).json({ success: true });
      }

      // 2. AUTH COR
      const credencialesBase64 = Buffer.from(`${process.env.COR_API_KEY}:${process.env.COR_CLIENT_SECRET}`).toString('base64');
      const tokenResponse = await fetch('https://api.projectcor.com/v1/oauth/token?grant_type=client_credentials', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${credencialesBase64}`, 'Content-Type': 'application/json' }
      });
      if (!tokenResponse.ok) throw new Error("Fallo en autenticación de COR");
      const tokenData = await tokenResponse.json();
      const reqOpts = { method: 'GET', headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' } };

      let allTasks = [];

      // 3. EXTRACCIÓN MASIVA (Datos crudos en segundo plano)
      for (const id of idsABuscar) {
        const fetchPromises = [];
        const colFilter = encodeURIComponent(JSON.stringify({ collaborator: id }));
        const pmFilter = encodeURIComponent(JSON.stringify({ pm: id }));
        
        for (let p = 1; p <= 4; p++) fetchPromises.push(fetch(`https://api.projectcor.com/v2/tasks?per_page=100&page=${p}&sort=updated_at&direction=desc&filters=${colFilter}`, reqOpts).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })));
        for (let p = 1; p <= 2; p++) fetchPromises.push(fetch(`https://api.projectcor.com/v2/tasks?per_page=100&page=${p}&sort=updated_at&direction=desc&filters=${pmFilter}`, reqOpts).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })));
        for (let p = 1; p <= 4; p++) fetchPromises.push(fetch(`https://api.projectcor.com/v1/tasks?collaborators=${id}&per_page=100&page=${p}`, reqOpts).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })));

        const results = await Promise.all(fetchPromises);
        results.forEach(d => {
          const list = Array.isArray(d) ? d : (d.data || d.items || []);
          allTasks = allTasks.concat(list);
        });
      }

      // 4. LIMPIEZA INVISIBLE
      const tasksUnicas = Array.from(new Map(allTasks.map(task => [task.id, task])).values());
      const now = new Date();
      const reporteParaIA = {};
      
      idsABuscar.forEach(id => {
        reporteParaIA[NOMBRES_POR_ID[id]] = { activas: [], vencidas: [] };
      });

      const agregarAsignado = (listaIds, userId) => {
        if (!userId) return;
        const idNum = Number(typeof userId === 'object' ? (userId.id || userId.value) : userId);
        if (idsABuscar.includes(idNum) && !listaIds.includes(NOMBRES_POR_ID[idNum])) {
          listaIds.push(NOMBRES_POR_ID[idNum]);
        }
      };

      tasksUnicas.forEach(tarea => {
        if (tarea.archived === true || tarea.archived === 1) return;

        let statusName = (typeof tarea.status === 'string') ? tarea.status.toLowerCase() : (tarea.status?.name || '').toLowerCase();
        let currentStatus = (typeof tarea.current_status === 'string') ? tarea.current_status.toLowerCase() : (tarea.current_status?.name || '').toLowerCase();
        const combinedStatus = `${statusName} ${currentStatus}`;
        if (combinedStatus.includes('finalizad') || combinedStatus.includes('completad') || combinedStatus.includes('done') || combinedStatus.includes('aprobada') || combinedStatus.includes('entregada')) return;

        const clientName = tarea.project?.client?.name || tarea.client?.name || 'Varios';
        let deadlineStr = tarea.deadline || 'Sin fecha';
        let isVencida = false;
        
        if (tarea.deadline) {
          const dateDeadline = new Date(tarea.deadline);
          if (dateDeadline < now) isVencida = true;
        }

        let asignadosParent = [];
        (tarea.collaborators || []).forEach(c => agregarAsignado(asignadosParent, c));
        (tarea.followers || []).forEach(f => agregarAsignado(asignadosParent, f));
        agregarAsignado(asignadosParent, tarea.pm);

        if (asignadosParent.length > 0) {
          const itemText = `[${clientName}] ${tarea.name || tarea.title || 'Sin título'} (Vence: ${deadlineStr})`;
          asignadosParent.forEach(nombre => {
            if (isVencida) reporteParaIA[nombre].vencidas.push(itemText);
            else reporteParaIA[nombre].activas.push(itemText);
          });
        }

        if (tarea.subtasks && Array.isArray(tarea.subtasks)) {
          tarea.subtasks.forEach(sub => {
            if (sub.archived === true || sub.archived === 1) return;
            let subStatus = (typeof sub.status === 'string') ? sub.status.toLowerCase() : (sub.status?.name || '').toLowerCase();
            if (subStatus.includes('finalizad') || subStatus.includes('completad') || subStatus.includes('done') || subStatus.includes('aprobada') || subStatus.includes('entregada')) return;

            let subDeadlineStr = sub.deadline || tarea.deadline || 'Sin fecha';
            let subIsVencida = false;
            if (subDeadlineStr !== 'Sin fecha') {
              const sDate = new Date(subDeadlineStr);
              if (sDate < now) subIsVencida = true;
            }

            let asignadosSub = [];
            (sub.collaborators || []).forEach(c => agregarAsignado(asignadosSub, c));
            (sub.followers || []).forEach(f => agregarAsignado(asignadosSub, f));
            agregarAsignado(asignadosSub, sub.pm);

            if (asignadosSub.length > 0) {
              const itemText = `[${clientName}] [Subtarea] ${sub.name || sub.title || 'Sin título'} (Vence: ${subDeadlineStr})`;
              asignadosSub.forEach(nombre => {
                if (subIsVencida) reporteParaIA[nombre].vencidas.push(itemText);
                else reporteParaIA[nombre].activas.push(itemText);
              });
            }
          });
        }
      });

      // 5. REDACCIÓN DEL REPORTE EJECUTIVO POR IA
      const fechaHoy = new Date().toLocaleString('es-AR', { timeZone: 'America/Buenos_Aires' });
      const promptSistema = `Eres el Director de Tráfico de Ninch. Hoy es ${fechaHoy}.
      Recibes un JSON con todas las tareas extraídas de la plataforma de gestión. El volumen es tan alto que una lista completa arruinaría la lectura en Slack.
      
      Tu objetivo es redactar un REPORTE EJECUTIVO fácil de leer. ESTÁ PROHIBIDO listar todas las tareas.
      
      ESTRUCTURA ESTRICTA POR PERSONA:
      # [Nombre del Colaborador]
      * 📊 **Volumen de Trabajo:** [X] Tareas Activas | [Y] Tareas Vencidas
      * 🏢 **Foco Actual:** [Menciona brevemente los 3 o 4 clientes/marcas principales que concentran su volumen de tareas]
      * 🚨 **Top 3 Urgencias:** [Lista en viñetas únicamente las 3 tareas más críticas. Prioriza las vencidas o las que vencen en las próximas 48hs. Usa el formato: **[Cliente]** Título de la tarea]
      * 🧠 **Veredicto de Disponibilidad:** [Un párrafo analítico de 3 líneas dictaminando si está disponible para un nuevo proyecto pesado o si su agenda requiere asistencia]`;
      
      // Eliminamos duplicados antes de pasar a la IA para ahorrar tokens
      for (const nom in reporteParaIA) {
        reporteParaIA[nom].activas = [...new Set(reporteParaIA[nom].activas)];
        reporteParaIA[nom].vencidas = [...new Set(reporteParaIA[nom].vencidas)];
      }

      const promptUsuario = `Datos masivos de COR: ${JSON.stringify(reporteParaIA)}. Redacta el reporte ejecutivo.`;

      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: promptSistema }, { role: "user", content: promptUsuario }],
          temperature: 0.5 
        })
      });
      
      let iaResponse = "No se pudo generar el análisis.";
      if (openaiResponse.ok) {
        const openaiData = await openaiResponse.json();
        iaResponse = openaiData.choices?.[0]?.message?.content || iaResponse;
      }

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
  return res.status(200).json({ response_type: "in_channel", text: "⏳ Procesando datos y redactando Reporte Ejecutivo..." });
}
