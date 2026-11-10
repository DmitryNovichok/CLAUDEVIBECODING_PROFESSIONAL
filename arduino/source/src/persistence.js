// Each progress field has its own storage key: independent tabs never overwrite
// an entire stale course snapshot. The previous format remains readable.
export function progressStore(storage, ids) {
  const fields = ['theory','circuit','run','homework','homeworkStatus','review','practiceNotes','practiceSteps'];
  const key = (id, field) => 'microlab.progress.' + id + '.' + field;
  const parse = value => { try { return JSON.parse(value); } catch { return null; } };
  return {
    read() {
      const legacy = parse(storage.getItem('microlab.academy.v1')) || {}, result = {};
      for (const id of ids) {
        const record = {};
        for (const field of fields) {
          const stored = storage.getItem(key(id,field));
          const value = stored === null ? legacy[id]?.[field] : parse(stored);
          if (value !== undefined && value !== null) record[field] = value;
        }
        if (Object.keys(record).length) result[id] = record;
      }
      return result;
    },
    patch(id, values) {
      if (!ids.includes(id)) throw Error('Неизвестный урок');
      for (const [field,value] of Object.entries(values)) {
        if (!fields.includes(field)) throw Error('Неизвестное поле прогресса');
        storage.setItem(key(id,field), JSON.stringify(value));
      }
      return this.read();
    },
    import(incoming) {
      const current = this.read();
      for (const id of ids) {
        const item = incoming?.[id]; if (!item || typeof item !== 'object') continue;
        const patch = {};
        for (const step of ['theory','circuit','run']) if (item[step] === true) patch[step] = true;
        for (const field of ['homework','practiceNotes']) if (typeof item[field] === 'string' && !current[id]?.[field]) patch[field] = item[field].slice(0,6000);
        if (Object.keys(patch).length) this.patch(id,patch);
      }
      return this.read();
    }
  };
}

export function captureChange(project, scope = 'diagram') {
  return {scope, value: structuredClone(scope === 'project' ? project : project[scope])};
}
export function restoreChange(project, change) {
  return change.scope === 'project' ? structuredClone(change.value) : {...project,[change.scope]:structuredClone(change.value)};
}
export function saveVersion(storage, key, project) {
  const serialized = JSON.stringify(project), previous = storage.getItem(key);
  if (previous === serialized) return;
  if (previous) {
    let versions; try { versions=JSON.parse(storage.getItem(key+'.versions')||'[]'); } catch { versions=[]; }
    if (!Array.isArray(versions)) versions=[];
    versions.unshift({at:new Date().toISOString(),project:JSON.parse(previous)});
    storage.setItem(key+'.versions',JSON.stringify(versions.slice(0,12)));
  }
  storage.setItem(key,serialized);
}

export function persistProject(storage,key,project,baseline) {
  const value=JSON.stringify(project),current=storage.getItem(key);
  if(current!==baseline && value!==current){
    if(value===baseline)return {value:baseline,unchanged:true};
    return {conflict:true,value:current};
  }
  saveVersion(storage,key,project);return {value};
}
