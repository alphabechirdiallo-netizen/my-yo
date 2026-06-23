import React, { createContext, useContext } from 'react';

export const CallContext = createContext({ initiateCall: () => {} });
export const useCall = () => useContext(CallContext);
