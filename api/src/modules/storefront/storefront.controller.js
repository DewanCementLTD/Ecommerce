export function getCompanyInfo(req, res) {
  res.json({ company: req.company });
}
