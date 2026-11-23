    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      render() {
        if (this.state.error) {
          return h('div', { style: { padding: '22px 28px', color: C.label1 } },
            h(Notice, { kind: 'error' },
              `这个页面出错了，可以点「重试」重新加载。错误详情：${String(this.state.error?.message || this.state.error)}`),
            h(Button, { onClick: () => this.setState({ error: null }) }, '重试'));
        }
        return this.props.children;
      }
    }

    /** 后台任务轮询：有运行中任务时 2s，否则 15s；页面隐藏时跳过。 */
    function useJobs(onFinish) {
      const [jobs, setJobs] = useState([]);
      const [error, setError] = useState(null);
      const [seen] = useState(() => ({}));
      const load = useCallback(async () => {
        try {
          const d = await api(R.jobs);
          const next = d.jobs || [];
          setJobs(next);
          setError(null);
          for (const job of next) {
            const prev = seen[job.id];
            seen[job.id] = job.status;
            if (prev === 'running' && job.status !== 'running') onFinish?.(job);
          }
        } catch (e) { setError(String(e?.message || e)); }
      }, [onFinish, seen]);
      useEffect(() => { load(); }, [load]);
      const anyRunning = jobs.some((j) => j.status === 'running');
      useEffect(() => {
        const timer = setInterval(load, anyRunning ? 2000 : 15000);
        // Node 测试环境里让定时器不阻塞进程退出（浏览器返回数字，无 unref）
        if (typeof timer?.unref === 'function') timer.unref();
        return () => clearInterval(timer);
      }, [load, anyRunning]);
      return { jobs, running: jobs.filter((j) => j.status === 'running'), error };
    }

    /** 顶栏任务入口：运行中数量 + 可展开列表与取消。 */
    function JobBadge({ running, onCancel }) {
      const [open, setOpen] = useState(false);
      if (!running.length) return null;
      return h('div', { style: { position: 'relative' } },
        h(Button, {
          size: 'sm', label: '运行中的任务', onClick: () => setOpen(!open),
        }, `⟳ ${running.length} 个任务运行中`),
        open
          ? h('div', {
            style: {
              position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 1050, width: 320,
              background: C.bg1, border: `1px solid ${C.border2}`, borderRadius: 8,
              padding: 10, boxShadow: '0 8px 28px rgba(0,0,0,.24)',
            },
          }, running.map((job) => h('div', {
            key: job.id,
            style: { display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' },
          },
            h('span', { style: { flex: 1, fontSize: fs(13), color: C.label2 } },
              `${job.name || job.id} · ${job.started_at ? new Date(job.started_at).toLocaleTimeString() : '—'}`),
            h(Button, { size: 'sm', label: `取消 ${job.name || job.id}`, onClick: () => onCancel(job.id) }, '取消'))))
          : null);
    }

    /** 整页骨架：首屏还没拿到 state 时用，避免一句「读取中…」。 */
    function PageSkeleton() {
      return h('div', { 'aria-busy': 'true', 'aria-label': '加载中' },
        h(Skeleton, { height: 64 }),
        h('div', {
          style: {
            display: 'grid', gap: T.space.md,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
          },
        }, [0, 1, 2, 3].map((i) => h(Skeleton, { key: i, height: 92 }))),
        h(Skeleton, { height: 220 }));
    }

    /** 轻提示：进入终态时给一条回执，4s 自动消失。 */
    function Toast({ toast, onClose }) {
      useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(onClose, 4000);
        return () => clearTimeout(timer);
      }, [toast, onClose]);
      if (!toast) return null;
      return h('div', {
        role: 'status', 'aria-live': 'polite',
        style: {
          position: 'fixed', right: 20, bottom: 20, zIndex: 1100, maxWidth: 380,
          background: C.bg1, border: `1px solid ${toast.kind === 'error' ? C.error : C.border2}`,
          color: toast.kind === 'error' ? C.error : C.label1, borderRadius: 8,
          padding: '10px 14px', fontSize: fs(13.5), lineHeight: 1.6, boxShadow: '0 8px 28px rgba(0,0,0,.24)',
        },
      }, toast.text);
    }

