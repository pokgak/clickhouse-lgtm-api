import 'dotenv/config';
import app from './app';

const PORT = process.env.PORT || 3100;

app.listen(PORT, () => {
  console.log(`ClickHouse LGTM API server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Loki API: http://localhost:${PORT}/loki/api/v1/`);
});