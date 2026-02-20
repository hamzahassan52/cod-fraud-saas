import {
  reactExtension,
  useApi,
  AdminBlock,
  BlockStack,
  Text,
  Badge,
  Button,
  Divider,
  Banner,
  useExtensionSettings,
} from '@shopify/ui-extensions-react/admin';
import { useState, useEffect } from 'react';

const TARGET = 'admin.order-details.block.render';

export default reactExtension(TARGET, () => <OrderRiskBadge />);

interface RiskData {
  found: boolean;
  order_id?: string;
  external_order_id?: string;
  risk_score?: number;
  risk_level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendation?: 'APPROVE' | 'VERIFY' | 'BLOCK';
  customer_name?: string;
  dashboard_url?: string;
}

function riskTone(level?: string): 'success' | 'warning' | 'critical' | 'info' {
  if (level === 'LOW') return 'success';
  if (level === 'MEDIUM') return 'warning';
  if (level === 'HIGH' || level === 'CRITICAL') return 'critical';
  return 'info';
}

function recTone(rec?: string): 'success' | 'warning' | 'critical' | 'info' {
  if (rec === 'APPROVE') return 'success';
  if (rec === 'VERIFY') return 'warning';
  if (rec === 'BLOCK') return 'critical';
  return 'info';
}

function OrderRiskBadge() {
  const { order } = useApi(TARGET);
  const settings = useExtensionSettings();
  const [riskData, setRiskData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiKey = settings.api_key as string;
  const apiBase = (settings.api_base_url as string) || 'https://cod-fraud-saas-production.up.railway.app';
  const orderId = order?.id;

  useEffect(() => {
    if (!apiKey || !orderId) {
      setLoading(false);
      return;
    }

    const numericId = orderId.replace(/[^0-9]/g, '');

    fetch(`${apiBase}/api/v1/orders/external/shopify/${numericId}`, {
      headers: { 'X-API-Key': apiKey },
    })
      .then(async (res) => {
        const data = await res.json();
        setRiskData(data);
      })
      .catch(() => setError('Failed to fetch risk data'))
      .finally(() => setLoading(false));
  }, [apiKey, orderId, apiBase]);

  if (!apiKey) {
    return (
      <AdminBlock title="COD Fraud Shield">
        <Banner tone="warning">
          <Text>Configure your API key in the extension settings to see risk scores.</Text>
        </Banner>
      </AdminBlock>
    );
  }

  if (loading) {
    return (
      <AdminBlock title="COD Fraud Shield">
        <Text tone="subdued">Loading risk score...</Text>
      </AdminBlock>
    );
  }

  if (error || !riskData?.found) {
    return (
      <AdminBlock title="COD Fraud Shield">
        <Text tone="subdued">{error || 'Order not yet scored. Process it through COD Fraud Shield first.'}</Text>
      </AdminBlock>
    );
  }

  return (
    <AdminBlock title="COD Fraud Shield — Risk Score">
      <BlockStack gap="base">
        <BlockStack gap="extraTight">
          <Text fontWeight="bold">Risk Score: {riskData.risk_score}/100</Text>
          <Text tone="subdued">Customer: {riskData.customer_name}</Text>
        </BlockStack>
        <Divider />
        <BlockStack gap="extraTight">
          <Text>Risk Level: <Badge tone={riskTone(riskData.risk_level)}>{riskData.risk_level}</Badge></Text>
          <Text>Recommendation: <Badge tone={recTone(riskData.recommendation)}>{riskData.recommendation}</Badge></Text>
        </BlockStack>
        {riskData.dashboard_url && (
          <>
            <Divider />
            <Button
              accessibilityLabel="View full analysis on COD Fraud Shield"
              onPress={() => open(riskData.dashboard_url!, '_blank')}
            >
              View Full Analysis →
            </Button>
          </>
        )}
      </BlockStack>
    </AdminBlock>
  );
}
