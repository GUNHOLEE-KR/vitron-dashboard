export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })

  const auth = req.headers['x-jira-auth']
  try {
    const response = await fetch('https://vi-tron.atlassian.net' + url, {
      headers: {
        Authorization: auth,
        Accept: 'application/json'
      }
    })
    const data = await response.json()
    res.status(response.status).json(data)
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
}