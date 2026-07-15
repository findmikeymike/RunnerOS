# Order Flow Specialist Research Basis

Status: implemented doctrine for `order-flow-specialist@0.1.0`.

## Primary findings encoded in the agent

- CME distinguishes Market by Price from Market by Order: MBP aggregates quantity and limits depth, while MBO exposes anonymous individual orders, priority, and full depth. The agent therefore declares its feed capability and never claims queue-level evidence from trades-only or MBP data. Source: [CME Market by Order FAQ](https://www.cmegroup.com/articles/faqs/market-by-order-mbo.html).
- CME's MDP trade summary explicitly identifies when aggressor side is defined and documents cases where no aggressor is defined. The agent preserves unknown aggression instead of forcing classification. Source: [CME MDP 3.0 Trade Summary Order Level Detail](https://cmegroupclientsite.atlassian.net/wiki/spaces/EPICSANDBOX/pages/457225774/MDP+3.0+-+Trade+Summary+Order+Level+Detail).
- Lee and Ready show that trade direction often must be inferred from trades/quotes and that quote timing and inside-spread trades create classification problems. The agent labels inferred aggression and cannot present it as exchange-observed. Source: [Lee and Ready, Journal of Finance](https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.1991.tb02683.x).
- Cont, Kukanov, and Stoikov find short-horizon price changes relate more robustly to order-flow imbalance than trade volume alone, with impact dependent on market depth. The agent therefore pairs flow with price response and refuses volume-only certainty. Source: [The Price Impact of Order Book Events](https://arxiv.org/abs/1011.6402).
- Regulators evaluate spoofing using intent, trading patterns, fill characteristics, and market context. Displayed imbalance alone cannot establish it. The agent is prohibited from diagnosing spoofing from a snapshot. Source: [CFTC interpretive guidance](https://www.cftc.gov/LawRegulation/FederalRegister/FinalRules/2013-12365.html).

## Consequence for version 0.1.0

The current deterministic kernel supplies trades, aggression, volume/delta, price, candles, quality, freshness, and provenance. It does not yet supply MBO/MBP depth, add/cancel events, queue position, or a statistically meaningful live sequence. The first agent can responsibly discuss executed flow and price response, but must refuse strong absorption, exhaustion, hidden-liquidity, spoofing, or queue claims until those sensors exist.
