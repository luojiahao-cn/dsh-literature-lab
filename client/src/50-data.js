    /**
     * 统一接口调用：解析 JSON；非 2xx 或 {ok:false} 一律抛错。
     * 目的：禁止再用「catch 后返回 null」的写法把失败静默成"什么都没发生"。
     */
    async function api(path, options) {
      let res;
      try {
        res = await fetch(path, { credentials: 'same-origin', ...(options || {}) });
      } catch (e) {
        const raw = String(e?.message || e);
        const hint = /Failed to fetch|NetworkError|load failed/i.test(raw)
          ? '连不上本地服务：确认 DSH 还在运行，然后重试'
          : raw;
        throw new Error(`网络错误：${hint}`);
      }
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok || !data || data.ok === false) {
        const code = Number(res.status) || 0;
        const hint = code === 400 ? '请求内容不对'
          : code === 401 || code === 403 ? '没有权限'
            : code === 404 ? '找不到这个功能（插件版本可能不匹配）'
              : code === 409 ? '当前状态不允许这个操作'
                : code >= 500 ? '插件内部出错了，稍后重试'
                  : '请求失败';
        throw new Error(data?.error || `${hint}（${code}）`);
      }
      return data;
    }

    /** GET 的语义别名：Workbench 里的局部变量叫 api（useApi 的返回值），用它避免遮蔽。 */
    function fetchJson(path) {
      return api(path);
    }

    /** POST JSON 的快捷方式。 */
    function postJson(path, body) {
      return api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
    }

    /**
     * 启动后台 job 并轮询到终态。
     * - 组件卸载后停止，不再对已卸载组件 setState
     * - 轮询上限到点不静默：返回 warn 文案
     * - 返回 { kind, text, result }；被取消时返回 null
     * 用 useState 承载可变控制块，避免依赖 useRef 在宿主/测试之间的差异。
     */
    function useJobRunner() {
      const [ctl] = useState(() => ({ cancelled: false, busy: false }));
      useEffect(() => () => { ctl.cancelled = true; }, [ctl]);
      return async ({ start, maxTicks = 40, pollMs = 2000, format }) => {
        if (ctl.busy) return null;
        ctl.busy = true;
        try {
          const started = await start();
          const jobId = started?.job?.id;
          if (!jobId) return { kind: 'error', text: '未能启动任务（没有 job id）' };
          for (let i = 0; i < maxTicks; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, pollMs));
            if (ctl.cancelled) return null;
            const jobs = await api(R.jobs);
            const job = (jobs.jobs || []).find((item) => item.id === jobId);
            if (!job || job.status === 'running') continue;
            if (job.status === 'done') return { kind: 'success', text: format(job.result || {}), result: job.result };
            const jobStatusText = { failed: '失败', cancelled: '已取消', error: '出错' }[job.status] || '没有完成';
            return { kind: 'error', text: job.error || `任务${jobStatusText}` };
          }
          return { kind: 'warn', text: '任务仍在后台运行，稍后刷新查看' };
        } catch (e) {
          return { kind: 'error', text: String(e?.message || e) };
        } finally {
          ctl.busy = false;
        }
      };
    }

    // ── 数据 hooks ────────────────────────────────────────────
    function useApi() {
      const [state, setState] = useState(null);
      const [config, setConfig] = useState(null);
      const [hasApiKey, setHasApiKey] = useState(false);
      const [hasEasyScholarKey, setHasEasyScholarKey] = useState(false);
      const [hasInstitutionalCookie, setHasInstitutionalCookie] = useState(false);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);

      const reload = useCallback(async () => {
        setBusy(true);
        try {
          const [s, c] = await Promise.all([api(`${R.state}?limit=100`), api(R.config)]);
          setState(s);
          setConfig(c.config);
          setHasApiKey(Boolean(c.hasApiKey));
          setHasEasyScholarKey(Boolean(c.hasEasyScholarKey));
          setHasInstitutionalCookie(Boolean(c.hasInstitutionalCookie));
          setError(null);
        } catch (e) {
          setError(String(e?.message || e));
        } finally {
          setBusy(false);
        }
      }, []);

      useEffect(() => { reload(); }, [reload]);

      const loadMore = useCallback(async () => {
        if (!state || (state.papers?.length || 0) >= (state.total || 0)) return;
        setBusy(true);
        try {
          const d = await api(`${R.state}?limit=100&offset=${state.papers.length}`);
          setState((prev) => prev ? {
            ...prev,
            papers: [...prev.papers, ...d.papers],
            offset: d.offset,
            limit: d.limit,
            total: d.total,
          } : prev);
        } catch (e) { setError(String(e?.message || e)); }
        finally { setBusy(false); }
      }, [state]);

      const saveConfig = useCallback(async (patch) => {
        setBusy(true);
        try {
          const d = await postJson(R.config, patch);
          setConfig(d.config);
          setHasApiKey(Boolean(d.hasApiKey));
          setHasEasyScholarKey(Boolean(d.hasEasyScholarKey));
          if (typeof d.hasInstitutionalCookie === 'boolean') setHasInstitutionalCookie(d.hasInstitutionalCookie);
          setError(null);
          return true;
        } catch (e) { setError(String(e?.message || e)); return false; }
        finally { setBusy(false); }
      }, []);

      const overridePaper = useCallback(async (id, patch) => {
        try {
          const d = await postJson(R.paperOverride, { id, ...patch });
          await reload();
          return d;
        } catch (e) {
          setError(String(e?.message || e));
          throw e;
        }
      }, [reload]);

      const runDiscover = useCallback(async (only) => {
        setBusy(true);
        try {
          const d = await postJson(R.discover, Array.isArray(only) && only.length ? { only } : {});
          await reload();
          return d;
        } catch (e) { setError(String(e?.message || e)); return null; }
        finally { setBusy(false); }
      }, [reload]);

      const saveCredential = useCallback(async (key) => {
        try {
          const d = await postJson(R.credentials, { zoteroApiKey: String(key || '') });
          setHasApiKey(Boolean(d.hasApiKey));
          setHasEasyScholarKey(Boolean(d.hasEasyScholarKey));
          setHasInstitutionalCookie(Boolean(d.hasInstitutionalCookie));
          return true;
        } catch (e) { setError(String(e?.message || e)); return false; }
      }, []);

      /** 机构会话 Cookie：只写不读回；空串表示清除。 */
      const saveInstitutionalCookie = useCallback(async (cookie) => {
        try {
          const d = await postJson(R.credentials, { institutionalCookie: String(cookie || '') });
          setHasInstitutionalCookie(Boolean(d.hasInstitutionalCookie));
          return true;
        } catch (e) { setError(String(e?.message || e)); return false; }
      }, []);

      /** 机构访问自检：拿一个链接真的试一次，返回分类结果（不写任何状态）。 */
      const testAccess = useCallback(async (url) => postJson(R.accessTest, { url: String(url || '') }), []);

      /**
       * easyScholar key 走同一个凭据接口，只是 body 字段不同。
       * 空串＝清除；返回 boolean 让设置页能区分成功与失败。
       */
      const saveEasyScholarKey = useCallback(async (key) => {
        try {
          const d = await postJson(R.credentials, { easyScholarKey: String(key || '') });
          setHasApiKey(Boolean(d.hasApiKey));
          setHasEasyScholarKey(Boolean(d.hasEasyScholarKey));
          return true;
        } catch (e) { setError(String(e?.message || e)); return false; }
      }, []);

      // 阅读队列：标已读 / 未读（单条或批量），成功后重新拉 state
      const markPaperRead = useCallback(async (idOrIds, read = true) => {
        const payload = Array.isArray(idOrIds) ? { ids: idOrIds, read } : { id: idOrIds, read };
        try {
          await postJson(R.paperRead, payload);
          await reload();
          return true;
        } catch (e) { setError(String(e?.message || e)); return false; }
      }, [reload]);

      // hasEasyScholarKey 是设置页 easyScholar 卡片的已有标记：读不到就当 false。
      const translatePaper = useCallback(async (id, force = false) => {
        try {
          const d = await postJson(R.paperTranslate, { id, force });
          await reload();
          return d;
        } catch (e) { setError(String(e?.message || e)); throw e; }
      }, [reload]);

      return { state, config, error, busy, reload, loadMore, saveConfig, saveCredential, saveEasyScholarKey, saveInstitutionalCookie, testAccess, hasApiKey, hasEasyScholarKey, hasInstitutionalCookie, runDiscover, setConfig, overridePaper, markPaperRead, translatePaper };
    }

