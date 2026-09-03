use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

/// Handle to a cancellable / pausable long-running task (SCAN-all, MONITOR,
/// batch operations, …). Kept alive in the registry keyed by task id.
pub struct TaskHandle {
    id: String,
    cancel: CancellationToken,
    paused: Arc<AtomicBool>,
}

impl TaskHandle {
    pub fn id(&self) -> &str { &self.id }
    pub fn is_cancelled(&self) -> bool { self.cancel.is_cancelled() }
    pub fn is_paused(&self) -> bool { self.paused.load(Ordering::SeqCst) }

    /// Used at the top of a loop; awaits while paused, exits when cancelled.
    pub async fn tick(&self) {
        while self.paused.load(Ordering::SeqCst) && !self.cancel.is_cancelled() {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    }

    pub fn cancel(&self) { self.cancel.cancel(); }
    pub fn set_pause(&self, p: bool) { self.paused.store(p, Ordering::SeqCst); }
}

/// Global registry of in-flight tasks. Managed as Tauri state.
#[derive(Default)]
pub struct TaskRegistry {
    tasks: Mutex<HashMap<String, Arc<TaskHandle>>>,
}

impl TaskRegistry {
    pub fn register(&self, id: &str) -> Arc<TaskHandle> {
        let h = Arc::new(TaskHandle {
            id: id.to_string(),
            cancel: CancellationToken::new(),
            paused: Arc::new(AtomicBool::new(false)),
        });
        self.tasks.lock().unwrap().insert(id.to_string(), h.clone());
        h
    }

    pub fn cancel(&self, id: &str) {
        if let Some(h) = self.tasks.lock().unwrap().get(id) {
            h.cancel();
        }
    }

    pub fn pause(&self, id: &str) {
        if let Some(h) = self.tasks.lock().unwrap().get(id) {
            h.set_pause(true);
        }
    }

    pub fn resume(&self, id: &str) {
        if let Some(h) = self.tasks.lock().unwrap().get(id) {
            h.set_pause(false);
        }
    }

    pub fn get(&self, id: &str) -> Option<Arc<TaskHandle>> {
        self.tasks.lock().unwrap().get(id).cloned()
    }

    pub fn remove(&self, id: &str) {
        self.tasks.lock().unwrap().remove(id);
    }
}
