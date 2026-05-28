export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })

  const email = process.env.JIRA_EMAIL
  const token = process.env.JIRA_TOKEN

  console.log('email:', email)
  console.log('token exists:', !!token)
  console.log('url:', url)

  const auth = 'Basic ' + Buffer.from(email + ':' + token).toString('base64')

  try {
    const response = await fetch('https://vi-tron.atlassian.net' + url, {
      headers: { Authorization: auth, Accept: 'application/json' }
    })
    const text = await response.text()
    console.log('jira response status:', response.status)
    console.log('jira response:', text.slice(0, 200))
    res.status(response.status).json(JSON.parse(text))
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
}