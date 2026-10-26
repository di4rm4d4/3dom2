# Security

The local Node server is intended for one person on loopback. The separate Cloudflare Worker handles public hosting. Keep API credentials in server-side environment variables or Worker secrets.

Public-source retrieval is bounded and checks destinations against private-network addresses. Model output and publication names are treated as untrusted input. These controls do not establish that a source is truthful or that an ownership claim is correct.

For a suspected vulnerability, use GitHub's private vulnerability reporting if it is available. Otherwise, open an issue asking for a private contact without including an exploit, credentials, personal maps or other sensitive details. Ordinary source corrections can be reported in a public issue with the publication name, dated evidence and affected relationship.
