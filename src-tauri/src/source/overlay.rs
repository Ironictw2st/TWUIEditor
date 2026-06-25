//! A `DataSource` that layers one source over another: reads resolve from `top`
//! first, falling back to `base`. Used by "open a single pack file" overlay mode
//! (a chosen pack on top of the merged install).

use super::DataSource;
use std::collections::BTreeSet;
use std::sync::Arc;

pub struct OverlaySource {
    top: Arc<dyn DataSource>,
    base: Arc<dyn DataSource>,
}

impl OverlaySource {
    pub fn new(top: Arc<dyn DataSource>, base: Arc<dyn DataSource>) -> Self {
        OverlaySource { top, base }
    }
}

impl DataSource for OverlaySource {
    fn read(&self, rel: &str) -> Option<Vec<u8>> {
        self.top.read(rel).or_else(|| self.base.read(rel))
    }

    fn read_text(&self, rel: &str) -> Option<String> {
        self.top.read_text(rel).or_else(|| self.base.read_text(rel))
    }

    fn exists(&self, rel: &str) -> bool {
        self.top.exists(rel) || self.base.exists(rel)
    }

    fn list(&self, pred: &dyn Fn(&str) -> bool) -> Vec<String> {
        // Deduped union; BTreeSet keeps it sorted (matches the other sources).
        let mut set: BTreeSet<String> = BTreeSet::new();
        set.extend(self.top.list(pred));
        set.extend(self.base.list(pred));
        set.into_iter().collect()
    }
}
