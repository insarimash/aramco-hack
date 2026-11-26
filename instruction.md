# Cargo Document Bundle – Input Requirements

To create a valid input file for the regulatory compliance assessment system, combine the following five documents into a single PDF:

**1. Monthly Production Report**
- Producer name and installation ID
- Production location and reporting period
- Production method and product purity
- Total monthly ammonia production (tonnes)
- Natural gas feed and fuel consumption (GJ, LHV)
- Natural gas emission factor (t CO₂/TJ)
- Total electricity consumption (MWh)
- Daily production and gas consumption records

**2. Bill of Lading**
- Bill of lading number and cargo lot number
- Shipper and consignee
- Product description and CN/HS code
- Cargo quantity (metric tonnes)
- Port of loading and discharge
- Shipment date
- Production installation ID and production period

**3. Certificate of Origin**
- Certificate number
- Exporter and consignee
- Country of origin and destination
- Product description and CN/HS code
- Cargo quantity
- Producing installation ID
- Bill of lading reference

**4. Electricity Invoice**
- Electricity supplier and customer
- Invoice number and billing period
- Production facility
- Total electricity consumption (MWh)
- Grid emission factor (t CO₂/MWh)
- Renewable energy certificate or power purchase agreement (PPA) status

**5. CO₂ Capture & Storage Report**
- Operator and installation ID
- Reporting period
- CO₂ capture source
- Storage location and storage method
- Total CO₂ permanently stored (tonnes)
- Total CO₂ transferred for utilization, including urea production (tonnes)
- Daily CO₂ measurement records

## Document Consistency Requirements

- All five documents must be combined into one readable PDF.
- All documents must refer to the same cargo or its associated production facility and production period.
- Installation IDs, product codes, shipment references and cargo quantities must be consistent across relevant documents.
- Production, electricity consumption and carbon capture reporting periods must match.
- Monthly production quantity and individual cargo quantity must be clearly distinguished.
- All numerical values must include their measurement units.
- If a value is zero, explicitly state zero rather than leaving the field empty.
- Missing information must not be replaced with assumed values.

Recommended filename: `Cargo_Lot_[ID]_documents.pdf`

If any mandatory document or required information is missing, the input should be classified as incomplete and should not receive a definitive regulatory compliance or subsidy eligibility assessment.