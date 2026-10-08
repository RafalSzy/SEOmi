pub(crate) struct RenderRequestScope<'a> {
    pub(crate) base_host: &'a str,
    pub(crate) max_redirects: usize,
}

impl<'a> RenderRequestScope<'a> {
    pub(crate) fn new(base_host: &'a str, max_redirects: usize) -> Self {
        Self {
            base_host,
            max_redirects,
        }
    }
}
